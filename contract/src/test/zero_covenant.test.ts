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
    expect(l.epochRoots.size()).toBe(0n);
    expect(toHex(l.entityCommitment)).toBe(toHex(pureCircuits.deriveEntityCommitment(deskSecret)));
  });

  it("proves solvency & custodian diversification in ZK and anchors historical epochRoots", async () => {
    const deskSecret = fromSeedByte(0x21);
    const salt = fromSeedByte(0x77);
    const sim = await ZeroCovenantSimulator.create({ deskSecret });
    sim.setPrivateSnapshot({
      custodianBalances: [3_500_000n, 3_000_000n, 2_500_000n, 3_000_000n],
      totalLiabilities: 9_000_000n,
      epochSalt: salt
    });

    const { rootHex, ledger } = await sim.attestSolvency();
    expect(ledger.lastSolvencyVerified).toBe(true);
    expect(ledger.attestationCount).toBe(1n);
    expect(ledger.epoch).toBe(2n);
    expect(ledger.lastAttestedEpoch).toBe(1n);
    expect(toHex(ledger.lastSolvencyRoot)).toBe(rootHex);
    expect(ledger.epochRoots.member(1n)).toBe(true);
    expect(toHex(ledger.epochRoots.lookup(1n))).toBe(rootHex);
    expect(ledger.usedNullifiers.size()).toBe(1n);

    // Pure circuit recomputation bound to entityCommitment & epoch must match exactly
    const recomputed = pureCircuits.computeReserveRoot(
      ledger.entityCommitment,
      1n,
      3_500_000n,
      3_000_000n,
      2_500_000n,
      3_000_000n,
      9_000_000n,
      salt
    );
    expect(toHex(recomputed)).toBe(rootHex);
  });

  it("rejects undercollateralized balance sheet (< 120% covenant)", async () => {
    const sim = await ZeroCovenantSimulator.create({ deskSecret: fromSeedByte(0x22) });
    sim.setPrivateSnapshot({
      custodianBalances: [2_500_000n, 2_500_000n, 2_500_000n, 2_500_000n],
      totalLiabilities: 9_500_000n,
      epochSalt: fromSeedByte(0x88)
    });

    await expect(sim.attestSolvency()).rejects.toThrow(/Solvency covenant ratio breached/);
  });

  it("rejects zero liabilities to block vacuous solvency proofs", async () => {
    const sim = await ZeroCovenantSimulator.create({ deskSecret: fromSeedByte(0x29) });
    sim.setPrivateSnapshot({
      custodianBalances: [3_000_000n, 3_000_000n, 3_000_000n, 3_000_000n],
      totalLiabilities: 0n,
      epochSalt: fromSeedByte(0x89)
    });

    await expect(sim.attestSolvency()).rejects.toThrow(/Total liabilities must be strictly positive/);
  });

  it("rejects concentrated single-custodian exposure (> 40% cap)", async () => {
    const sim = await ZeroCovenantSimulator.create({ deskSecret: fromSeedByte(0x23) });
    sim.setPrivateSnapshot({
      custodianBalances: [6_000_000n, 2_000_000n, 2_000_000n, 2_000_000n],
      totalLiabilities: 5_000_000n,
      epochSalt: fromSeedByte(0x99)
    });

    await expect(sim.attestSolvency()).rejects.toThrow(/Custodian 0 concentration exceeds covenant cap/);
  });

  it("rejects cross-epoch blinding salt replay via usedNullifiers", async () => {
    const sim = await ZeroCovenantSimulator.create({ deskSecret: fromSeedByte(0x26) });
    const reusedSalt = fromSeedByte(0x55);
    sim.setPrivateSnapshot({
      custodianBalances: [3_200_000n, 3_100_000n, 2_900_000n, 2_800_000n],
      totalLiabilities: 8_000_000n,
      epochSalt: reusedSalt
    });

    const first = await sim.attestSolvency();
    expect(first.ledger.epoch).toBe(2n);

    // Re-submitting the SAME salt in Epoch 2 must trigger Nullifier replay detected
    await expect(sim.attestSolvency()).rejects.toThrow(/Nullifier replay detected/);
  });

  it("rejects unauthorized desk secret key", async () => {
    const sim = await ZeroCovenantSimulator.create({ deskSecret: fromSeedByte(0x24) });
    sim.setPrivateSnapshot({ deskSecret: fromSeedByte(0xff) });
    await expect(sim.attestSolvency()).rejects.toThrow(/Unauthorized desk secret key/);
  });

  it("publishes one-way root-bound auditor disclosure tag with zero deskSecret leakage", async () => {
    const deskSecret = fromSeedByte(0x25);
    const auditorPk = fromSeedByte(0xaa);
    const sim = await ZeroCovenantSimulator.create({ deskSecret });
    const att = await sim.attestSolvency();

    const { tagHex, grantKeyHex, ledger } = await sim.grantAuditorDisclosure(auditorPk, 1n);
    const grantKeyBytes = pureCircuits.computeGrantKey(auditorPk, 1n);
    const expectedTag = pureCircuits.computeDisclosureTag(ledger.epochRoots.lookup(1n), auditorPk, 1n);

    expect(toHex(grantKeyBytes)).toBe(grantKeyHex);
    expect(ledger.auditorGrants.member(grantKeyBytes)).toBe(true);
    expect(toHex(ledger.auditorGrants.lookup(grantKeyBytes))).toBe(tagHex);
    expect(tagHex).toBe(toHex(expectedTag));
    // Verify disclosure tag matches independent pure hash without needing deskSecret
    expect(toHex(pureCircuits.computeDisclosureTag(att.ledger.lastSolvencyRoot, auditorPk, 1n))).toBe(tagHex);
  });

  it("enforces monotonic covenant tightening, feasible >=2500 bps cap, and resets lastSolvencyVerified", async () => {
    const sim = await ZeroCovenantSimulator.create({
      deskSecret: fromSeedByte(0x27),
      initialMinRatioBps: 12_000n,
      initialMaxSingleBps: 4_000n
    });
    await sim.attestSolvency();
    expect(sim.getLedger().lastSolvencyVerified).toBe(true);

    // Loosening solvency ratio or concentration cap MUST be rejected
    await expect(sim.tightenCovenantPolicy(10_000n, 4_000n)).rejects.toThrow(/can only tighten/);
    await expect(sim.tightenCovenantPolicy(12_000n, 5_000n)).rejects.toThrow(/can only tighten/);

    // Concentration cap < 2500 bps is mathematically infeasible for 4 custodians -> MUST reject
    await expect(sim.tightenCovenantPolicy(12_000n, 2_000n)).rejects.toThrow(/2500\.\.10000 bps/);

    // Valid monotonic tightening succeeds and invalidates prior solvency verification flag
    const updated = await sim.tightenCovenantPolicy(15_000n, 3_500n);
    expect(updated.covenantMinRatioBps).toBe(15_000n);
    expect(updated.covenantMaxSingleBps).toBe(3_500n);
    expect(updated.lastSolvencyVerified).toBe(false);
  });
});
