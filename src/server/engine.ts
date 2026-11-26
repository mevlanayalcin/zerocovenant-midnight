import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { pureCircuits } from "../../contract/src/managed/zero_covenant/contract/index.js";
import {
  ZeroCovenantSimulator,
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
  epochRootsCount: string;
  auditorGrantsCount: string;
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

export interface PublicDeskSessionState {
  sessionId: string;
  deskName: string;
  publicLedger: PublicLedgerSnapshot;
  epochRoots: Record<string, string>;
  history: CircuitEventRecord[];
  grants: AuditorGrantRecord[];
  lastNullifierHex: string | null;
}

export interface ClientSeedBundle {
  custodianLabels: [string, string, string, string];
  epoch: string;
  custodianBalancesUsd: [string, string, string, string];
  totalLiabilitiesUsd: string;
  epochSaltHex: string;
  defaultAuditorLabel: string;
}

export const CUSTODIAN_LABELS: [string, string, string, string] = [
  "Fireblocks Vault",
  "Coinbase Prime Cold",
  "Anchorage Digital",
  "Copper ClearLoop"
];

function parseBytes32Hex(input: string): Uint8Array {
  const clean = input.trim().toLowerCase().replace(/^0x/, "");
  if (/^[0-9a-f]{64}$/.test(clean)) {
    return Uint8Array.from(Buffer.from(clean, "hex"));
  }
  if (input.trim().length > 0) {
    return Uint8Array.from(createHash("sha256").update(input.trim()).digest());
  }
  return Uint8Array.from(randomBytes(32));
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

const ZERO_SALT = new Uint8Array(32);

class ManagedDeskSession {
  readonly sessionId: string;
  readonly deskName: string;
  readonly simulator: ZeroCovenantSimulator;
  readonly createdAtMs: number;
  lastAccessMs: number;
  private deskSecret: Uint8Array;
  private sessionTokenHash: Buffer;
  readonly history: CircuitEventRecord[] = [];
  readonly grants: AuditorGrantRecord[] = [];
  private lastNullifierHex: string | null = null;
  private attestedEpochs: bigint[] = [];

  constructor(
    sessionId: string,
    deskName: string,
    simulator: ZeroCovenantSimulator,
    deskSecret: Uint8Array,
    sessionToken: string
  ) {
    this.sessionId = sessionId;
    this.deskName = deskName;
    this.simulator = simulator;
    this.deskSecret = deskSecret;
    this.sessionTokenHash = createHash("sha256").update(sessionToken).digest();
    this.createdAtMs = Date.now();
    this.lastAccessMs = this.createdAtMs;
  }

  verifySessionToken(candidate: string | undefined): boolean {
    if (!candidate || typeof candidate !== "string") return false;
    const candidateHash = createHash("sha256").update(candidate).digest();
    if (candidateHash.length !== this.sessionTokenHash.length) return false;
    return timingSafeEqual(candidateHash, this.sessionTokenHash);
  }

  private scrubTransientWitnesses(): void {
    // Wipe transient balance sheet & salt from prover memory after every circuit call;
    // the server NEVER retains or exposes private witness balances via GET /api/v1/session.
    this.simulator.setPrivateSnapshot({
      custodianBalances: [0n, 0n, 0n, 0n],
      totalLiabilities: 0n,
      epochSalt: ZERO_SALT
    });
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

  publicSnapshot(): PublicDeskSessionState {
    this.lastAccessMs = Date.now();
    const l = this.simulator.getLedger();
    const epochRootsObj: Record<string, string> = {};
    for (const ep of this.attestedEpochs) {
      if (l.epochRoots.member(ep)) {
        epochRootsObj[ep.toString()] = toHex(l.epochRoots.lookup(ep));
      }
    }

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
        epochRootsCount: l.epochRoots.size().toString(),
        auditorGrantsCount: l.auditorGrants.size().toString()
      },
      epochRoots: epochRootsObj,
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

  async runAttestSolvency(input: {
    custodianBalances: [bigint, bigint, bigint, bigint];
    totalLiabilities: bigint;
    epochSaltHex?: string;
    autoFreshSalt?: boolean;
  }): Promise<{
    ok: boolean;
    event: CircuitEventRecord;
    state: PublicDeskSessionState;
    committedSaltHex: string;
    attestedEpoch?: string;
    error?: string;
  }> {
    this.lastAccessMs = Date.now();
    const nextSalt =
      input.autoFreshSalt === false && input.epochSaltHex
        ? parseBytes32Hex(input.epochSaltHex)
        : input.epochSaltHex && input.autoFreshSalt === undefined
          ? parseBytes32Hex(input.epochSaltHex)
          : Uint8Array.from(randomBytes(32));

    const committedSaltHex = toHex(nextSalt);

    this.simulator.setPrivateSnapshot({
      deskSecret: this.deskSecret,
      custodianBalances: input.custodianBalances,
      totalLiabilities: input.totalLiabilities,
      epochSalt: nextSalt
    });

    const epochBefore = this.simulator.getLedger().epoch;
    const expectedNullifier = toHex(pureCircuits.computeNullifier(this.deskSecret, nextSalt));
    const t0 = performance.now();

    try {
      const res = await this.simulator.attestSolvency();
      const durationMs = Math.round(performance.now() - t0);
      this.lastNullifierHex = expectedNullifier;
      if (!this.attestedEpochs.includes(epochBefore)) {
        this.attestedEpochs.push(epochBefore);
      }
      const ev = this.pushEvent({
        circuit: "attestSolvency",
        status: "VERIFIED",
        epochBefore: epochBefore.toString(),
        epochAfter: res.ledger.epoch.toString(),
        durationMs,
        reserveRootHex: res.rootHex,
        nullifierHex: expectedNullifier,
        message: `Epoch ${epochBefore.toString()} solvency + 4-custodian concentration covenant verified in compiled Compact off-chain simulator (no ZK proof generated in studio) without exposing asset or liability figures to public state.`
      });
      return {
        ok: true,
        event: ev,
        state: this.publicSnapshot(),
        committedSaltHex,
        attestedEpoch: epochBefore.toString()
      };
    } catch (err) {
      const durationMs = Math.round(performance.now() - t0);
      const msg = extractErrorMessage(err);
      // Reverted transitions do NOT mutate public ledger state or append to public GET /api/v1/session history,
      // eliminating even existence-of-failure side channels from public observers.
      const ev: CircuitEventRecord = {
        id: `rej_${Date.now().toString(36)}`,
        timestamp: new Date().toISOString(),
        circuit: "attestSolvency",
        status: "REJECTED",
        epochBefore: epochBefore.toString(),
        epochAfter: this.simulator.getLedger().epoch.toString(),
        durationMs,
        message: msg,
        privateFieldsLeaked: 0
      };
      return { ok: false, error: msg, event: ev, state: this.publicSnapshot(), committedSaltHex };
    } finally {
      this.scrubTransientWitnesses();
    }
  }

  async simulateRogueKeyAttack(): Promise<{
    ok: false;
    blocked: true;
    event: CircuitEventRecord;
    state: PublicDeskSessionState;
    error: string;
  }> {
    this.lastAccessMs = Date.now();
    const epochBefore = this.simulator.getLedger().epoch;
    const rogueKey = Uint8Array.from(randomBytes(32));
    // Supply valid balances/liabilities so ONLY the rogue desk secret causes rejection
    this.simulator.setPrivateSnapshot({
      deskSecret: rogueKey,
      custodianBalances: [3_200_000n, 3_100_000n, 2_900_000n, 2_800_000n],
      totalLiabilities: 8_000_000n,
      epochSalt: Uint8Array.from(randomBytes(32))
    });
    const t0 = performance.now();

    let caughtMessage = "";
    let rogueRejected = false;
    try {
      await this.simulator.attestSolvency();
    } catch (err) {
      caughtMessage = extractErrorMessage(err);
      rogueRejected = caughtMessage.includes("Unauthorized desk secret");
    } finally {
      this.simulator.setPrivateSnapshot({ deskSecret: this.deskSecret });
      this.scrubTransientWitnesses();
    }

    const durationMs = Math.round(performance.now() - t0);
    if (!rogueRejected) {
      throw new Error(
        caughtMessage
          ? `Rogue key test failed for unexpected reason instead of auth check: ${caughtMessage}`
          : "CRITICAL: Unauthorized desk secret unexpectedly passed attestSolvency()"
      );
    }

    const ev = this.pushEvent({
      circuit: "rogueKeyTest",
      status: "REJECTED",
      epochBefore: epochBefore.toString(),
      epochAfter: this.simulator.getLedger().epoch.toString(),
      durationMs,
      message: `Unauthorized desk secret blocked cleanly: ${caughtMessage}`
    });
    return { ok: false, blocked: true, error: caughtMessage, event: ev, state: this.publicSnapshot() };
  }

  async grantAuditor(input: {
    auditorLabel: string;
    targetEpoch?: bigint;
  }): Promise<{
    ok: boolean;
    grant?: AuditorGrantRecord;
    event: CircuitEventRecord;
    state: PublicDeskSessionState;
    error?: string;
  }> {
    this.lastAccessMs = Date.now();
    const ledgerNow = this.simulator.getLedger();
    const targetEpoch = input.targetEpoch ?? ledgerNow.lastAttestedEpoch;
    const auditorPk = parseBytes32Hex(input.auditorLabel);
    const epochBefore = ledgerNow.epoch;
    const t0 = performance.now();

    try {
      this.simulator.setPrivateSnapshot({ deskSecret: this.deskSecret });
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
      const existingIdx = this.grants.findIndex((g) => g.grantKeyHex === grant.grantKeyHex);
      if (existingIdx >= 0) {
        this.grants[existingIdx] = grant;
      } else {
        this.grants.unshift(grant);
      }
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
        message: `Selective epoch-${targetEpoch.toString()} one-way disclosure tag published for ${input.auditorLabel} (zero secret-key exposure).`
      });
      return { ok: true, grant, event: ev, state: this.publicSnapshot() };
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
      return { ok: false, error: msg, event: ev, state: this.publicSnapshot() };
    } finally {
      this.scrubTransientWitnesses();
    }
  }

  async tightenPolicy(input: {
    minRatioBps: bigint;
    maxSingleBps: bigint;
  }): Promise<{ ok: boolean; event: CircuitEventRecord; state: PublicDeskSessionState; error?: string }> {
    this.lastAccessMs = Date.now();
    const epochBefore = this.simulator.getLedger().epoch;
    const t0 = performance.now();

    try {
      this.simulator.setPrivateSnapshot({ deskSecret: this.deskSecret });
      const nextLedger = await this.simulator.tightenCovenantPolicy(input.minRatioBps, input.maxSingleBps);
      const durationMs = Math.round(performance.now() - t0);
      const ev = this.pushEvent({
        circuit: "tightenCovenantPolicy",
        status: "VERIFIED",
        epochBefore: epochBefore.toString(),
        epochAfter: nextLedger.epoch.toString(),
        durationMs,
        message: `Simulated ledger risk covenant tightened: Min Solvency ${formatPctFromBps(input.minRatioBps)}, Max Single Custodian ${formatPctFromBps(input.maxSingleBps)}. Re-attestation required (lastSolvencyVerified reset to false).`
      });
      return { ok: true, event: ev, state: this.publicSnapshot() };
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
      return { ok: false, error: msg, event: ev, state: this.publicSnapshot() };
    } finally {
      this.scrubTransientWitnesses();
    }
  }

  verifyDisclosurePacket(input: {
    auditorLabel: string;
    targetEpoch: bigint;
    custodianBalances: [bigint, bigint, bigint, bigint];
    totalLiabilities: bigint;
    epochSaltHex: string;
  }) {
    this.lastAccessMs = Date.now();
    const ledgerNow = this.simulator.getLedger();
    const auditorPk = parseBytes32Hex(input.auditorLabel);
    const salt = parseBytes32Hex(input.epochSaltHex);

    const recomputedRootBytes = pureCircuits.computeReserveRoot(
      ledgerNow.entityCommitment,
      input.targetEpoch,
      input.custodianBalances[0],
      input.custodianBalances[1],
      input.custodianBalances[2],
      input.custodianBalances[3],
      input.totalLiabilities,
      salt
    );
    const recomputedRoot = toHex(recomputedRootBytes);

    const recomputedGrantKeyBytes = pureCircuits.computeGrantKey(auditorPk, input.targetEpoch);
    const recomputedGrantKey = toHex(recomputedGrantKeyBytes);

    const recomputedTagBytes = pureCircuits.computeDisclosureTag(recomputedRootBytes, auditorPk, input.targetEpoch);
    const recomputedTagHex = toHex(recomputedTagBytes);

    const epochRootOnLedger = ledgerNow.epochRoots.member(input.targetEpoch);
    const ledgerEpochRootHex = epochRootOnLedger ? toHex(ledgerNow.epochRoots.lookup(input.targetEpoch)) : null;
    const rootMatchesEpoch = epochRootOnLedger && ledgerEpochRootHex === recomputedRoot;

    const grantOnLedger = ledgerNow.auditorGrants.member(recomputedGrantKeyBytes);
    const ledgerTagHex = grantOnLedger ? toHex(ledgerNow.auditorGrants.lookup(recomputedGrantKeyBytes)) : null;
    const tagMatchesLedger = grantOnLedger && ledgerTagHex === recomputedTagHex;

    const verified = grantOnLedger && rootMatchesEpoch && tagMatchesLedger;

    const totalAssets = input.custodianBalances.reduce((a, b) => a + b, 0n);
    const ratioBps = input.totalLiabilities > 0n ? (totalAssets * 10000n) / input.totalLiabilities : 0n;
    const maxBal = input.custodianBalances.reduce((m, b) => (b > m ? b : m), 0n);
    const maxShareBps = totalAssets > 0n ? (maxBal * 10000n) / totalAssets : 0n;

    return {
      verified,
      grantOnLedger,
      rootMatchesEpoch,
      tagMatchesLedger,
      ledgerTagHex,
      recomputedTagHex,
      recomputedGrantKey,
      recomputedRoot,
      ledgerEpochRootHex,
      ledgerRootHex: ledgerEpochRootHex ?? toHex(ledgerNow.lastSolvencyRoot),
      targetEpoch: input.targetEpoch.toString(),
      lastAttestedEpoch: ledgerNow.lastAttestedEpoch.toString(),
      auditedTotalAssetsUsd: totalAssets.toString(),
      auditedTotalLiabilitiesUsd: input.totalLiabilities.toString(),
      auditedSolvencyPct: formatPctFromBps(ratioBps),
      auditedMaxCustodianPct: formatPctFromBps(maxShareBps)
    };
  }
}

const MAX_SESSIONS = 200;
const sessions = new Map<string, ManagedDeskSession>();

function evictOldestIfNeeded(): void {
  if (sessions.size < MAX_SESSIONS) return;
  let oldestKey: string | null = null;
  let oldestTs = Infinity;
  for (const [key, sess] of sessions.entries()) {
    if (sess.lastAccessMs < oldestTs) {
      oldestTs = sess.lastAccessMs;
      oldestKey = key;
    }
  }
  if (oldestKey) sessions.delete(oldestKey);
}

async function createSeededSession(
  sessionId: string,
  deskName: string
): Promise<{
  session: ManagedDeskSession;
  sessionToken: string;
  initialClientSeed: ClientSeedBundle;
}> {
  evictOldestIfNeeded();

  // Cryptographically random desk secret + authentication token per visitor session
  const deskSecret = Uint8Array.from(randomBytes(32));
  const sessionToken = randomBytes(24).toString("hex");
  const epoch1SaltHex = toHex(Uint8Array.from(randomBytes(32)));

  const sim = await ZeroCovenantSimulator.create({
    deskSecret,
    initialMinRatioBps: 12_000n,
    initialMaxSingleBps: 4_000n
  });

  const managed = new ManagedDeskSession(sessionId, deskName, sim, deskSecret, sessionToken);

  const seedBalances: [bigint, bigint, bigint, bigint] = [3_200_000n, 3_100_000n, 2_900_000n, 2_800_000n];
  const seedLiabilities = 8_000_000n;
  const defaultAuditor = "finra-institutional-audit-2026";

  await managed.runAttestSolvency({
    custodianBalances: seedBalances,
    totalLiabilities: seedLiabilities,
    epochSaltHex: epoch1SaltHex,
    autoFreshSalt: false
  });
  await managed.grantAuditor({
    auditorLabel: defaultAuditor,
    targetEpoch: 1n
  });

  sessions.set(sessionId, managed);

  return {
    session: managed,
    sessionToken,
    initialClientSeed: {
      custodianLabels: CUSTODIAN_LABELS,
      epoch: "1",
      custodianBalancesUsd: [
        seedBalances[0].toString(),
        seedBalances[1].toString(),
        seedBalances[2].toString(),
        seedBalances[3].toString()
      ],
      totalLiabilitiesUsd: seedLiabilities.toString(),
      epochSaltHex: epoch1SaltHex,
      defaultAuditorLabel: defaultAuditor
    }
  };
}

export async function initIsolatedSession(preferredDeskName?: string): Promise<{
  session: ManagedDeskSession;
  sessionToken: string;
  initialClientSeed: ClientSeedBundle;
}> {
  const sessionId = `desk_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
  const cleanName = (preferredDeskName || "Institutional Treasury Desk").trim().slice(0, 48);
  return createSeededSession(sessionId, cleanName || "Institutional Treasury Desk");
}

export function getExistingSession(sessionId: string): ManagedDeskSession | null {
  const safeId = sessionId.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 48);
  if (!safeId) return null;
  return sessions.get(safeId) ?? null;
}

export async function resetAuthenticatedSession(
  sessionId: string,
  sessionToken: string | undefined
): Promise<{
  session: ManagedDeskSession;
  sessionToken: string;
  initialClientSeed: ClientSeedBundle;
} | null> {
  const existing = getExistingSession(sessionId);
  if (!existing || !existing.verifySessionToken(sessionToken)) {
    return null;
  }
  const deskName = existing.deskName;
  sessions.delete(existing.sessionId);
  return createSeededSession(existing.sessionId, deskName);
}
