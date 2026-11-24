import { describe, expect, it } from "vitest";
import { ZeroCovenantSimulator, fromSeedByte, toHex } from "../simulator.js";
import { pureCircuits } from "../managed/zero_covenant/contract/index.js";

describe("ZeroCovenant Compact Contract (Ledger 9 / Compact 0.28)", () => {
  it("initializes dual-ledger state with public policy and hidden desk secret commitment", async () => {
    const deskSecret = fromSeedByte(0x21);
    const sim = await ZeroCovenantSimulator.create({
      deskSecret,
      initialMinRatioBps: 12_000n,
      initialMaxSingleBps: 4_000n
    });
    const l = sim.getLedger();
    expect(l.epoch).toBe(1n);
    expect(l.attestationCount).toBe(0n);
    expect(l.covenantMinRatioBps).toBe(12_000n);
    expect(l.covenantMaxSingleBps).toBe(4_000n);
    expect(l.lastSolvencyVerified).toBe(false);
    expect(toHex(l.entityCommitment)).toBe(toHex(pureCircuits.deriveEntityCommitment(deskSecret)));
  });

  it("proves solvency & custodian diversification in ZK without leaking balances", async () => {
    const deskSecret = fromSeedByte(0x21);
    const sim = await ZeroCovenantSimulator.create({ deskSecret });
    sim.setPrivateSnapshot({
      custodianBalances: [3_500_000n, 3_000_000n, 2_500_000n, 3_000_000n], // 12M total, max 29.17% <= 40%
      totalLiabilities: 9_000_000n, // 133.3% ratio >= 120%
      epochSalt: fromSeedByte(0x77)
    });

    const { rootHex, ledger } = await sim.attestSolvency();
    expect(ledger.lastSolvencyVerified).toBe(true);
    expect(ledger.attestationCount).toBe(1n);
    expect(ledger.epoch).toBe(2n);
    expect(ledger.lastAttestedEpoch).toBe(1n);
    expect(toHex(ledger.lastSolvencyRoot)).toBe(rootHex);
    expect(ledger.usedNullifiers.size()).toBe(1n);
  });

  it("rejects undercollateralized balance sheet (< 120% covenant)", async () => {
    const sim = await ZeroCovenantSimulator.create({ deskSecret: fromSeedByte(0x22) });
    sim.setPrivateSnapshot({
      custodianBalances: [2_500_000n, 2_500_000n, 2_500_000n, 2_500_000n], // 10M total
      totalLiabilities: 9_500_000n, // 105.26% < 120%
      epochSalt: fromSeedByte(0x88)
    });

    await expect(sim.attestSolvency()).rejects.toThrow(/Solvency covenant ratio breached/);
  });

  it("rejects concentrated single-custodian exposure (> 40% cap)", async () => {
    const sim = await ZeroCovenantSimulator.create({ deskSecret: fromSeedByte(0x23) });
    sim.setPrivateSnapshot({
      custodianBalances: [6_000_000n, 2_000_000n, 2_000_000n, 2_000_000n], // 50% in Custodian 0 > 40%
      totalLiabilities: 5_000_000n,
      epochSalt: fromSeedByte(0x99)
    });

    await expect(sim.attestSolvency()).rejects.toThrow(/Custodian 0 concentration exceeds covenant cap/);
  });

  it("rejects unauthorized desk secret key", async () => {
    const sim = await ZeroCovenantSimulator.create({ deskSecret: fromSeedByte(0x24) });
    sim.setPrivateSnapshot({ deskSecret: fromSeedByte(0xff) });
    await expect(sim.attestSolvency()).rejects.toThrow(/Unauthorized desk secret key/);
  });

  it("grants selective auditor disclosure and enforces tighter covenant policy", async () => {
    const deskSecret = fromSeedByte(0x25);
    const auditorPk = fromSeedByte(0xaa);
    const sim = await ZeroCovenantSimulator.create({ deskSecret });
    await sim.attestSolvency();

    const { tagHex, grantKeyHex, ledger } = await sim.grantAuditorDisclosure(auditorPk, 1n);
    const grantKeyBytes = pureCircuits.computeGrantKey(auditorPk, 1n);
    expect(toHex(grantKeyBytes)).toBe(grantKeyHex);
    expect(ledger.auditorGrants.member(grantKeyBytes)).toBe(true);
    expect(toHex(ledger.auditorGrants.lookup(grantKeyBytes))).toBe(tagHex);

    const updated = await sim.tightenCovenantPolicy(15_000n, 3_500n);
    expect(updated.covenantMinRatioBps).toBe(15_000n);
    expect(updated.covenantMaxSingleBps).toBe(3_500n);
  });
});
