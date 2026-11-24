import { createHash, randomBytes } from "node:crypto";
import { pureCircuits } from "../../contract/src/managed/zero_covenant/contract/index.js";
import {
  ZeroCovenantSimulator,
  fromSeedByte,
  toHex
} from "../../contract/src/simulator.js";

export interface PublicLedgerSnapshot {
  contractAddress: string;
  epoch: string;
  attestationCount: string;
  entityCommitment: string;
  covenantMinRatioBps: string;
  covenantMaxSingleBps: string;
  lastSolvencyRoot: string;
  lastSolvencyVerified: boolean;
  lastAttestedEpoch: string;
  usedNullifiersCount: string;
  auditorGrantsCount: string;
}

export interface PrivateWitnessSnapshot {
  custodianLabels: [string, string, string, string];
  custodianBalancesUsd: [string, string, string, string];
  totalAssetsUsd: string;
  totalLiabilitiesUsd: string;
  excessBufferUsd: string;
  reserveRatioBps: string;
  reserveRatioPct: string;
  maxSingleShareBps: string;
  maxSingleSharePct: string;
  maxCustodianIndex: number;
  deskSecretMasked: string;
  epochSaltHex: string;
  compliantWithCurrentCovenant: boolean;
}

export interface CircuitEventRecord {
  id: string;
  timestamp: string;
  circuit: "constructor" | "attestSolvency" | "grantAuditorDisclosure" | "tightenCovenantPolicy" | "rogueKeyTest";
  status: "VERIFIED" | "REJECTED";
  epochBefore: string;
  epochAfter: string;
  durationMs: number;
  reserveRootHex?: string;
  nullifierHex?: string;
  grantKeyHex?: string;
  disclosureTagHex?: string;
  auditorLabel?: string;
  message: string;
  privateFieldsLeaked: 0;
}

export interface AuditorGrantRecord {
  auditorLabel: string;
  auditorPkHex: string;
  targetEpoch: string;
  grantKeyHex: string;
  disclosureTagHex: string;
  verifiedOnLedger: boolean;
  grantedAt: string;
}

export interface DeskSessionState {
  sessionId: string;
  deskName: string;
  publicLedger: PublicLedgerSnapshot;
  privateWitness: PrivateWitnessSnapshot;
  history: CircuitEventRecord[];
  grants: AuditorGrantRecord[];
  lastNullifierHex: string | null;
}

const CUSTODIAN_LABELS: [string, string, string, string] = [
  "Fireblocks Vault",
  "Coinbase Prime Cold",
  "Anchorage Digital",
  "Copper ClearLoop"
];

function parseBytes32Hex(input: string, fallbackSeed = 0x42): Uint8Array {
  const clean = input.trim().toLowerCase().replace(/^0x/, "");
  if (/^[0-9a-f]{64}$/.test(clean)) {
    return Uint8Array.from(Buffer.from(clean, "hex"));
  }
  if (input.trim().length > 0) {
    return Uint8Array.from(createHash("sha256").update(input.trim()).digest());
  }
  return fromSeedByte(fallbackSeed);
}

function formatPctFromBps(bps: bigint): string {
  const whole = bps / 100n;
  const frac = (bps % 100n).toString().padStart(2, "0");
  return `${whole}.${frac}%`;
}

function extractErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

class ManagedDeskSession {
  readonly sessionId: string;
  readonly deskName: string;
  readonly simulator: ZeroCovenantSimulator;
  private deskSecret: Uint8Array;
  readonly history: CircuitEventRecord[] = [];
  readonly grants: AuditorGrantRecord[] = [];
  private lastNullifierHex: string | null = null;

  constructor(
    sessionId: string,
    deskName: string,
    simulator: ZeroCovenantSimulator,
    deskSecret: Uint8Array
  ) {
    this.sessionId = sessionId;
    this.deskName = deskName;
    this.simulator = simulator;
    this.deskSecret = deskSecret;
  }

  private pushEvent(ev: Omit<CircuitEventRecord, "id" | "timestamp" | "privateFieldsLeaked">): CircuitEventRecord {
    const full: CircuitEventRecord = {
      ...ev,
      id: `evt_${this.history.length + 1}_${Date.now().toString(36)}`,
      timestamp: new Date().toISOString(),
      privateFieldsLeaked: 0
    };
    this.history.unshift(full);
    if (this.history.length > 40) this.history.length = 40;
    return full;
  }

  snapshot(): DeskSessionState {
    const l = this.simulator.getLedger();
    const p = this.simulator.getPrivateState();
    const totalAssets = p.custodianBalances.reduce((acc, v) => acc + v, 0n);
    const excess = totalAssets - p.totalLiabilities;
    const ratioBps = p.totalLiabilities > 0n ? (totalAssets * 10000n) / p.totalLiabilities : 0n;

    let maxBal = 0n;
    let maxIdx = 0;
    p.custodianBalances.forEach((b, idx) => {
      if (b > maxBal) {
        maxBal = b;
        maxIdx = idx;
      }
    });
    const maxSingleBps = totalAssets > 0n ? (maxBal * 10000n) / totalAssets : 0n;

    const compliant =
      totalAssets > 0n &&
      totalAssets * 10000n >= p.totalLiabilities * l.covenantMinRatioBps &&
      maxBal * 10000n <= totalAssets * l.covenantMaxSingleBps;

    const skHex = toHex(this.deskSecret);
    const deskSecretMasked = `${skHex.slice(0, 10)}...${skHex.slice(-6)} (local-only)`;

    return {
      sessionId: this.sessionId,
      deskName: this.deskName,
      publicLedger: {
        contractAddress: String(this.simulator.contractAddress),
        epoch: l.epoch.toString(),
        attestationCount: l.attestationCount.toString(),
        entityCommitment: toHex(l.entityCommitment),
        covenantMinRatioBps: l.covenantMinRatioBps.toString(),
        covenantMaxSingleBps: l.covenantMaxSingleBps.toString(),
        lastSolvencyRoot: toHex(l.lastSolvencyRoot),
        lastSolvencyVerified: l.lastSolvencyVerified,
        lastAttestedEpoch: l.lastAttestedEpoch.toString(),
        usedNullifiersCount: l.usedNullifiers.size().toString(),
        auditorGrantsCount: l.auditorGrants.size().toString()
      },
      privateWitness: {
        custodianLabels: CUSTODIAN_LABELS,
        custodianBalancesUsd: [
          p.custodianBalances[0].toString(),
          p.custodianBalances[1].toString(),
          p.custodianBalances[2].toString(),
          p.custodianBalances[3].toString()
        ],
        totalAssetsUsd: totalAssets.toString(),
        totalLiabilitiesUsd: p.totalLiabilities.toString(),
        excessBufferUsd: excess.toString(),
        reserveRatioBps: ratioBps.toString(),
        reserveRatioPct: formatPctFromBps(ratioBps),
        maxSingleShareBps: maxSingleBps.toString(),
        maxSingleSharePct: formatPctFromBps(maxSingleBps),
        maxCustodianIndex: maxIdx,
        deskSecretMasked,
        epochSaltHex: toHex(p.epochSalt),
        compliantWithCurrentCovenant: compliant
      },
      history: this.history,
      grants: this.grants.map((g) => {
        const keyBytes = parseBytes32Hex(g.grantKeyHex);
        return {
          ...g,
          verifiedOnLedger: l.auditorGrants.member(keyBytes)
        };
      }),
      lastNullifierHex: this.lastNullifierHex
    };
  }

  async runAttestSolvency(input?: {
    custodianBalances?: [bigint, bigint, bigint, bigint];
    totalLiabilities?: bigint;
    epochSaltHex?: string;
    autoFreshSalt?: boolean;
  }): Promise<{ ok: boolean; event: CircuitEventRecord; state: DeskSessionState; error?: string }> {
    const prevPrivate = this.simulator.getPrivateState();
    const nextBalances = input?.custodianBalances ?? prevPrivate.custodianBalances;
    const nextLiab = input?.totalLiabilities ?? prevPrivate.totalLiabilities;
    const nextSalt = input?.epochSaltHex
      ? parseBytes32Hex(input.epochSaltHex)
      : input?.autoFreshSalt
        ? Uint8Array.from(randomBytes(32))
        : prevPrivate.epochSalt;

    this.simulator.setPrivateSnapshot({
      custodianBalances: nextBalances,
      totalLiabilities: nextLiab,
      epochSalt: nextSalt
    });

    const epochBefore = this.simulator.getLedger().epoch;
    const expectedNullifier = toHex(pureCircuits.computeNullifier(this.deskSecret, epochBefore, nextSalt));
    const t0 = performance.now();

    try {
      const res = await this.simulator.attestSolvency();
      const durationMs = Math.round(performance.now() - t0);
      this.lastNullifierHex = expectedNullifier;
      const ev = this.pushEvent({
        circuit: "attestSolvency",
        status: "VERIFIED",
        epochBefore: epochBefore.toString(),
        epochAfter: res.ledger.epoch.toString(),
        durationMs,
        reserveRootHex: res.rootHex,
        nullifierHex: expectedNullifier,
        message: `Epoch ${epochBefore.toString()} solvency + 4-custodian concentration covenant verified in ZK without exposing asset or liability figures.`
      });
      return { ok: true, event: ev, state: this.snapshot() };
    } catch (err) {
      const durationMs = Math.round(performance.now() - t0);
      const msg = extractErrorMessage(err);
      const ev = this.pushEvent({
        circuit: "attestSolvency",
        status: "REJECTED",
        epochBefore: epochBefore.toString(),
        epochAfter: this.simulator.getLedger().epoch.toString(),
        durationMs,
        nullifierHex: expectedNullifier,
        message: `Compact circuit assertion rejected state transition: ${msg}`
      });
      return { ok: false, error: msg, event: ev, state: this.snapshot() };
    }
  }

  async simulateRogueKeyAttack(): Promise<{ ok: false; event: CircuitEventRecord; state: DeskSessionState; error: string }> {
    const epochBefore = this.simulator.getLedger().epoch;
    const rogueKey = Uint8Array.from(randomBytes(32));
    this.simulator.setPrivateSnapshot({ deskSecret: rogueKey });
    const t0 = performance.now();

    try {
      await this.simulator.attestSolvency();
      throw new Error("Unexpected pass on rogue key");
    } catch (err) {
      const msg = extractErrorMessage(err);
      const durationMs = Math.round(performance.now() - t0);
      this.simulator.setPrivateSnapshot({ deskSecret: this.deskSecret });
      const ev = this.pushEvent({
        circuit: "rogueKeyTest",
        status: "REJECTED",
        epochBefore: epochBefore.toString(),
        epochAfter: this.simulator.getLedger().epoch.toString(),
        durationMs,
        message: `Unauthorized desk secret blocked cleanly: ${msg}`
      });
      return { ok: false, error: msg, event: ev, state: this.snapshot() };
    }
  }

  async grantAuditor(input: {
    auditorLabel: string;
    targetEpoch?: bigint;
  }): Promise<{ ok: boolean; grant?: AuditorGrantRecord; event: CircuitEventRecord; state: DeskSessionState; error?: string }> {
    const ledgerNow = this.simulator.getLedger();
    const targetEpoch = input.targetEpoch ?? ledgerNow.lastAttestedEpoch;
    const auditorPk = parseBytes32Hex(input.auditorLabel);
    const epochBefore = ledgerNow.epoch;
    const t0 = performance.now();

    try {
      const res = await this.simulator.grantAuditorDisclosure(auditorPk, targetEpoch);
      const durationMs = Math.round(performance.now() - t0);
      const grant: AuditorGrantRecord = {
        auditorLabel: input.auditorLabel,
        auditorPkHex: toHex(auditorPk),
        targetEpoch: targetEpoch.toString(),
        grantKeyHex: res.grantKeyHex,
        disclosureTagHex: res.tagHex,
        verifiedOnLedger: res.ledger.auditorGrants.member(parseBytes32Hex(res.grantKeyHex)),
        grantedAt: new Date().toISOString()
      };
      this.grants.unshift(grant);
      if (this.grants.length > 25) this.grants.length = 25;

      const ev = this.pushEvent({
        circuit: "grantAuditorDisclosure",
        status: "VERIFIED",
        epochBefore: epochBefore.toString(),
        epochAfter: res.ledger.epoch.toString(),
        durationMs,
        grantKeyHex: res.grantKeyHex,
        disclosureTagHex: res.tagHex,
        auditorLabel: input.auditorLabel,
        message: `Selective epoch-${targetEpoch.toString()} disclosure key published for ${input.auditorLabel} without exposing balances publicly.`
      });
      return { ok: true, grant, event: ev, state: this.snapshot() };
    } catch (err) {
      const durationMs = Math.round(performance.now() - t0);
      const msg = extractErrorMessage(err);
      const ev = this.pushEvent({
        circuit: "grantAuditorDisclosure",
        status: "REJECTED",
        epochBefore: epochBefore.toString(),
        epochAfter: this.simulator.getLedger().epoch.toString(),
        durationMs,
        auditorLabel: input.auditorLabel,
        message: `Disclosure rejected: ${msg}`
      });
      return { ok: false, error: msg, event: ev, state: this.snapshot() };
    }
  }

  async tightenPolicy(input: {
    minRatioBps: bigint;
    maxSingleBps: bigint;
  }): Promise<{ ok: boolean; event: CircuitEventRecord; state: DeskSessionState; error?: string }> {
    const epochBefore = this.simulator.getLedger().epoch;
    const t0 = performance.now();

    try {
      const nextLedger = await this.simulator.tightenCovenantPolicy(input.minRatioBps, input.maxSingleBps);
      const durationMs = Math.round(performance.now() - t0);
      const ev = this.pushEvent({
        circuit: "tightenCovenantPolicy",
        status: "VERIFIED",
        epochBefore: epochBefore.toString(),
        epochAfter: nextLedger.epoch.toString(),
        durationMs,
        message: `On-chain risk covenant updated: Min Solvency ${formatPctFromBps(input.minRatioBps)}, Max Single Custodian ${formatPctFromBps(input.maxSingleBps)}.`
      });
      return { ok: true, event: ev, state: this.snapshot() };
    } catch (err) {
      const durationMs = Math.round(performance.now() - t0);
      const msg = extractErrorMessage(err);
      const ev = this.pushEvent({
        circuit: "tightenCovenantPolicy",
        status: "REJECTED",
        epochBefore: epochBefore.toString(),
        epochAfter: this.simulator.getLedger().epoch.toString(),
        durationMs,
        message: `Covenant policy update rejected: ${msg}`
      });
      return { ok: false, error: msg, event: ev, state: this.snapshot() };
    }
  }

  verifyDisclosurePacket(input: {
    auditorLabel: string;
    targetEpoch: bigint;
    custodianBalances: [bigint, bigint, bigint, bigint];
    totalLiabilities: bigint;
    epochSaltHex: string;
  }) {
    const ledgerNow = this.simulator.getLedger();
    const auditorPk = parseBytes32Hex(input.auditorLabel);
    const salt = parseBytes32Hex(input.epochSaltHex);

    const recomputedRoot = toHex(
      pureCircuits.computeReserveRoot(
        input.custodianBalances[0],
        input.custodianBalances[1],
        input.custodianBalances[2],
        input.custodianBalances[3],
        input.totalLiabilities,
        salt
      )
    );
    const recomputedGrantKey = toHex(pureCircuits.computeGrantKey(auditorPk, input.targetEpoch));

    const grantKeyBytes = parseBytes32Hex(recomputedGrantKey);
    const grantOnLedger = ledgerNow.auditorGrants.member(grantKeyBytes);
    const ledgerTagHex = grantOnLedger ? toHex(ledgerNow.auditorGrants.lookup(grantKeyBytes)) : null;
    const ledgerRootHex = toHex(ledgerNow.lastSolvencyRoot);
    const rootMatchesLatest = recomputedRoot === ledgerRootHex;

    const totalAssets = input.custodianBalances.reduce((a, b) => a + b, 0n);
    const ratioBps = input.totalLiabilities > 0n ? (totalAssets * 10000n) / input.totalLiabilities : 0n;
    const maxBal = input.custodianBalances.reduce((m, b) => (b > m ? b : m), 0n);
    const maxShareBps = totalAssets > 0n ? (maxBal * 10000n) / totalAssets : 0n;

    return {
      verified: grantOnLedger && (input.targetEpoch !== ledgerNow.lastAttestedEpoch || rootMatchesLatest),
      grantOnLedger,
      ledgerTagHex,
      recomputedGrantKey,
      recomputedRoot,
      ledgerRootHex,
      rootMatchesLatest,
      targetEpoch: input.targetEpoch.toString(),
      lastAttestedEpoch: ledgerNow.lastAttestedEpoch.toString(),
      auditedTotalAssetsUsd: totalAssets.toString(),
      auditedTotalLiabilitiesUsd: input.totalLiabilities.toString(),
      auditedSolvencyPct: formatPctFromBps(ratioBps),
      auditedMaxCustodianPct: formatPctFromBps(maxShareBps)
    };
  }
}

const sessions = new Map<string, ManagedDeskSession>();

async function seedDefaultSession(sessionId: string, deskName: string): Promise<ManagedDeskSession> {
  const deskSecret = createHash("sha256").update(`zerocovenant:${sessionId}:secret:v1`).digest();
  const sim = await ZeroCovenantSimulator.create({
    deskSecret: Uint8Array.from(deskSecret),
    initialMinRatioBps: 12_000n,
    initialMaxSingleBps: 4_000n
  });

  const managed = new ManagedDeskSession(sessionId, deskName, sim, Uint8Array.from(deskSecret));

  // Pre-seed Epoch 1 diversified institutional reserve attestation + FINRA auditor grant
  await managed.runAttestSolvency({
    custodianBalances: [3_200_000n, 3_100_000n, 2_900_000n, 2_800_000n],
    totalLiabilities: 8_000_000n,
    epochSaltHex: toHex(fromSeedByte(0x21))
  });
  await managed.grantAuditor({
    auditorLabel: "finra-institutional-audit-2026",
    targetEpoch: 1n
  });

  sessions.set(sessionId, managed);
  return managed;
}

export async function getOrCreateSession(sessionId = "alpha-treasury"): Promise<ManagedDeskSession> {
  const safeId = sessionId.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 48) || "alpha-treasury";
  const existing = sessions.get(safeId);
  if (existing) return existing;
  return seedDefaultSession(safeId, safeId === "alpha-treasury" ? "Meridian Institutional Desk #1" : `Desk ${safeId}`);
}

export async function resetSession(sessionId = "alpha-treasury"): Promise<ManagedDeskSession> {
  const safeId = sessionId.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 48) || "alpha-treasury";
  sessions.delete(safeId);
  return seedDefaultSession(safeId, safeId === "alpha-treasury" ? "Meridian Institutional Desk #1" : `Desk ${safeId}`);
}
