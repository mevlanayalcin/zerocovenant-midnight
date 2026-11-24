import React, { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Code2,
  Eye,
  EyeOff,
  FileCode2,
  KeyRound,
  Lock,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Terminal,
  Unlock,
  Wallet
} from "lucide-react";
import { VaultDiagram } from "./components/VaultDiagram";

interface PublicLedgerSnapshot {
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

interface PrivateWitnessSnapshot {
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

interface CircuitEventRecord {
  id: string;
  timestamp: string;
  circuit: string;
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
  privateFieldsLeaked: number;
}

interface AuditorGrantRecord {
  auditorLabel: string;
  auditorPkHex: string;
  targetEpoch: string;
  grantKeyHex: string;
  disclosureTagHex: string;
  verifiedOnLedger: boolean;
  grantedAt: string;
}

interface DeskSessionState {
  sessionId: string;
  deskName: string;
  publicLedger: PublicLedgerSnapshot;
  privateWitness: PrivateWitnessSnapshot;
  history: CircuitEventRecord[];
  grants: AuditorGrantRecord[];
  lastNullifierHex: string | null;
}

interface CompiledArtifacts {
  compilerVersion: string;
  languageVersion: string;
  runtimeVersion: string;
  ledgerVersion: string;
  sourceCode: string;
  sourceLines: number;
  circuits: Array<{
    name: string;
    pure: boolean;
    proof: boolean;
    zkirFile: string | null;
    zkirLines: number;
    zkirBytes: number;
    zkirOps: Record<string, number>;
    proverBytes: number;
    verifierBytes: number;
    verifierSha256: string | null;
  }>;
}

interface VerificationResponse {
  verified: boolean;
  grantOnLedger: boolean;
  ledgerTagHex: string | null;
  recomputedGrantKey: string;
  recomputedRoot: string;
  ledgerRootHex: string;
  rootMatchesLatest: boolean;
  targetEpoch: string;
  lastAttestedEpoch: string;
  auditedTotalAssetsUsd: string;
  auditedTotalLiabilitiesUsd: string;
  auditedSolvencyPct: string;
  auditedMaxCustodianPct: string;
}

type TabId = "studio" | "covenant" | "auditor" | "artifacts";

function formatUsd(val: string | number): string {
  const n = Number(val);
  if (!Number.isFinite(n)) return String(val);
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0
  }).format(n);
}

function shortHex(hex: string, head = 12, tail = 8): string {
  if (!hex || hex.length <= head + tail + 3) return hex;
  return `${hex.slice(0, head)}...${hex.slice(-tail)}`;
}

export default function App() {
  const [tab, setTab] = useState<TabId>("studio");
  const [sessionId] = useState("alpha-treasury");
  const [session, setSession] = useState<DeskSessionState | null>(null);
  const [artifacts, setArtifacts] = useState<CompiledArtifacts | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [banner, setBanner] = useState<{ kind: "ok" | "err" | "info"; text: string } | null>(null);

  // Witness form inputs
  const [balances, setBalances] = useState<[string, string, string, string]>([
    "3200000",
    "3100000",
    "2900000",
    "2800000"
  ]);
  const [liabilities, setLiabilities] = useState("8000000");
  const [autoFreshSalt, setAutoFreshSalt] = useState(true);
  const [manualSaltHex, setManualSaltHex] = useState("0x" + "21".repeat(32));

  // Covenant policy inputs
  const [policyMinRatioBps, setPolicyMinRatioBps] = useState("12500");
  const [policyMaxSingleBps, setPolicyMaxSingleBps] = useState("3500");

  // Selective auditor disclosure inputs
  const [auditorLabel, setAuditorLabel] = useState("sec-enforcement-desk-2026");
  const [targetEpoch, setTargetEpoch] = useState("1");

  // Independent Verifier inputs
  const [verifyLabel, setVerifyLabel] = useState("finra-institutional-audit-2026");
  const [verifyEpoch, setVerifyEpoch] = useState("1");
  const [verifyBalances, setVerifyBalances] = useState<[string, string, string, string]>([
    "3200000",
    "3100000",
    "2900000",
    "2800000"
  ]);
  const [verifyLiabilities, setVerifyLiabilities] = useState("8000000");
  const [verifySaltHex, setVerifySaltHex] = useState("0x" + "21".repeat(32));
  const [verification, setVerification] = useState<VerificationResponse | null>(null);

  // Midnight Lace wallet status
  const [walletStatus, setWalletStatus] = useState<{
    detected: boolean;
    connected: boolean;
    label: string;
  }>({
    detected: false,
    connected: false,
    label: "Scanning Lace..."
  });

  const syncFromSession = useCallback((s: DeskSessionState) => {
    setSession(s);
    setBalances([...s.privateWitness.custodianBalancesUsd]);
    setLiabilities(s.privateWitness.totalLiabilitiesUsd);
    setManualSaltHex(s.privateWitness.epochSaltHex);
    setTargetEpoch(s.publicLedger.lastAttestedEpoch || "1");
    setPolicyMinRatioBps(s.publicLedger.covenantMinRatioBps);
    setPolicyMaxSingleBps(s.publicLedger.covenantMaxSingleBps);
  }, []);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [sessRes, artRes] = await Promise.all([
        fetch(`/api/v1/session?sessionId=${encodeURIComponent(sessionId)}`),
        fetch("/api/v1/artifacts")
      ]);
      const sessJson = (await sessRes.json()) as { session: DeskSessionState };
      const artJson = (await artRes.json()) as CompiledArtifacts;
      syncFromSession(sessJson.session);
      setArtifacts(artJson);
    } catch (err) {
      setBanner({
        kind: "err",
        text: `Failed to initialize Midnight runtime: ${err instanceof Error ? err.message : String(err)}`
      });
    } finally {
      setLoading(false);
    }
  }, [sessionId, syncFromSession]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  useEffect(() => {
    const w = window as unknown as {
      midnight?: {
        mnLace?: {
          name?: string;
          apiVersion?: string;
          enable?: () => Promise<unknown>;
        };
      };
    };
    const detected = Boolean(w.midnight?.mnLace);
    setWalletStatus({
      detected,
      connected: false,
      label: detected
        ? `Lace v${w.midnight?.mnLace?.apiVersion ?? "3"} Detected`
        : "No Browser Lace — Ledger 9 WASM Active"
    });
  }, []);

  async function handleConnectLace() {
    const w = window as unknown as {
      midnight?: { mnLace?: { enable?: () => Promise<unknown>; apiVersion?: string } };
    };
    if (!w.midnight?.mnLace?.enable) {
      setBanner({
        kind: "info",
        text: "Lace browser extension is not installed in this browser. All Compact ZK transitions run live against the compiled Ledger 9 server runtime."
      });
      return;
    }
    try {
      await w.midnight.mnLace.enable();
      setWalletStatus({
        detected: true,
        connected: true,
        label: "Lace Midnight Connected"
      });
      setBanner({ kind: "ok", text: "Connected to Lace Midnight DApp Connector." });
    } catch (err) {
      setBanner({
        kind: "err",
        text: `Lace connection cancelled: ${err instanceof Error ? err.message : String(err)}`
      });
    }
  }

  async function handleAttest(override?: {
    balances: [string, string, string, string];
    liabilities: string;
    autoFresh: boolean;
    saltHex?: string;
    label: string;
  }) {
    setBusyAction(override?.label ?? "attest");
    setBanner(null);
    const b = override?.balances ?? balances;
    const l = override?.liabilities ?? liabilities;
    const fresh = override ? override.autoFresh : autoFreshSalt;
    const salt = override?.saltHex ?? manualSaltHex;

    if (override) {
      setBalances(b);
      setLiabilities(l);
      setAutoFreshSalt(fresh);
      if (salt) setManualSaltHex(salt);
    }

    try {
      const res = await fetch("/api/v1/attest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId,
          custodianBalances: b,
          totalLiabilities: l,
          autoFreshSalt: fresh,
          epochSaltHex: fresh ? undefined : salt
        })
      });
      const json = (await res.json()) as {
        ok: boolean;
        error?: string;
        event?: CircuitEventRecord;
        state?: DeskSessionState;
      };
      if (json.state) syncFromSession(json.state);
      if (json.ok) {
        setBanner({
          kind: "ok",
          text: `ZK Attestation Verified -> Root ${shortHex(json.event?.reserveRootHex ?? "")} committed to Midnight Ledger (0 private bytes leaked).`
        });
      } else {
        setBanner({
          kind: "err",
          text: `Compact Circuit Rejected Proof: ${json.error ?? "Assertion failed"} — On-chain ledger remained unchanged.`
        });
      }
    } catch (err) {
      setBanner({ kind: "err", text: String(err) });
    } finally {
      setBusyAction(null);
    }
  }

  async function handleRogueKeyAttack() {
    setBusyAction("rogue");
    setBanner(null);
    try {
      const res = await fetch("/api/v1/attack/rogue-key", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId })
      });
      const json = (await res.json()) as { error: string; state: DeskSessionState };
      syncFromSession(json.state);
      setBanner({
        kind: "ok",
        text: `Security Gate Enforced: Rogue key attestation blocked by Compact runtime ("${json.error}").`
      });
    } finally {
      setBusyAction(null);
    }
  }

  async function handleTightenPolicy(e: React.FormEvent) {
    e.preventDefault();
    setBusyAction("policy");
    setBanner(null);
    try {
      const res = await fetch("/api/v1/policy/tighten", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId,
          minRatioBps: policyMinRatioBps,
          maxSingleBps: policyMaxSingleBps
        })
      });
      const json = (await res.json()) as { ok: boolean; error?: string; state?: DeskSessionState };
      if (json.state) syncFromSession(json.state);
      setBanner({
        kind: json.ok ? "ok" : "err",
        text: json.ok
          ? `On-chain risk covenant updated via tightenCovenantPolicy().`
          : `Policy update rejected: ${json.error}`
      });
    } finally {
      setBusyAction(null);
    }
  }

  async function handleGrantAuditor(e: React.FormEvent) {
    e.preventDefault();
    setBusyAction("grant");
    setBanner(null);
    try {
      const res = await fetch("/api/v1/disclosure/grant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId,
          auditorLabel,
          targetEpoch
        })
      });
      const json = (await res.json()) as {
        ok: boolean;
        error?: string;
        grant?: AuditorGrantRecord;
        state?: DeskSessionState;
      };
      if (json.state) syncFromSession(json.state);
      setBanner({
        kind: json.ok ? "ok" : "err",
        text: json.ok
          ? `Selective disclosure key granted to "${auditorLabel}" for Epoch #${targetEpoch}.`
          : `Grant rejected: ${json.error}`
      });
    } finally {
      setBusyAction(null);
    }
  }

  async function handleVerifyPacket(e: React.FormEvent) {
    e.preventDefault();
    setBusyAction("verify");
    try {
      const res = await fetch("/api/v1/disclosure/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId,
          auditorLabel: verifyLabel,
          targetEpoch: verifyEpoch,
          custodianBalances: verifyBalances,
          totalLiabilities: verifyLiabilities,
          epochSaltHex: verifySaltHex
        })
      });
      const json = (await res.json()) as {
        ok: boolean;
        error?: string;
        verification?: VerificationResponse;
      };
      if (json.verification) {
        setVerification(json.verification);
      } else {
        setBanner({ kind: "err", text: json.error ?? "Verification failed" });
      }
    } finally {
      setBusyAction(null);
    }
  }

  async function handleReset() {
    setBusyAction("reset");
    const res = await fetch("/api/v1/session/reset", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId })
    });
    const json = (await res.json()) as { session: DeskSessionState };
    syncFromSession(json.session);
    setVerification(null);
    setBanner({ kind: "info", text: "Session reset to initial Epoch #1 institutional attestation state." });
    setBusyAction(null);
  }

  function downloadPreprodBundle() {
    const manifest = {
      protocol: "ZeroCovenant",
      networkTarget: "midnight-preprod",
      compiler: artifacts?.compilerVersion ?? "0.36.1",
      languageVersion: artifacts?.languageVersion ?? "0.28.0",
      runtimeVersion: artifacts?.runtimeVersion ?? "0.21.0",
      ledgerSnapshot: session?.publicLedger ?? null,
      compiledCircuits:
        artifacts?.circuits.map((c) => ({
          name: c.name,
          pure: c.pure,
          proof: c.proof,
          zkirLines: c.zkirLines,
          verifierSha256: c.verifierSha256
        })) ?? [],
      proofServerEndpoint: "http://127.0.0.1:6300"
    };
    const blob = new Blob([JSON.stringify(manifest, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "zerocovenant-midnight-bundle.json";
    a.click();
    URL.revokeObjectURL(url);
  }

  const pub = session?.publicLedger;
  const priv = session?.privateWitness;

  const liveTotal = balances.reduce((acc, v) => acc + (Number(v) || 0), 0);
  const liveLiab = Number(liabilities) || 0;
  const liveRatioPct = liveLiab > 0 ? (liveTotal / liveLiab) * 100 : 0;
  const liveMaxSharePct = liveTotal > 0 ? (Math.max(...balances.map((b) => Number(b) || 0)) / liveTotal) * 100 : 0;
  const minRatioPct = (Number(pub?.covenantMinRatioBps ?? 12000) / 100);
  const maxSinglePct = (Number(pub?.covenantMaxSingleBps ?? 4000) / 100);

  return (
    <div className="min-h-screen bg-[#07090f] text-slate-100">
      {/* Top Navbar */}
      <header className="sticky top-0 z-30 border-b border-slate-800/80 bg-[#07090f]/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-indigo-500/40 bg-indigo-500/15 text-indigo-400">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-base font-bold tracking-tight text-white">ZeroCovenant</span>
                <span className="rounded border border-indigo-500/40 bg-indigo-500/10 px-1.5 py-0.5 font-mono text-[10px] font-medium text-indigo-300">
                  COMPACT v{artifacts?.languageVersion ?? "0.28.0"} · LEDGER 9
                </span>
              </div>
              <p className="text-[11px] text-slate-400">
                Institutional ZK Proof-of-Solvency, Concentration Risk Covenant & Selective Auditor Disclosure on Midnight
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={handleConnectLace}
              className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition ${
                walletStatus.connected
                  ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                  : "border-slate-700 bg-slate-900 text-slate-200 hover:border-indigo-500/50"
              }`}
            >
              <Wallet className="h-3.5 w-3.5" />
              {walletStatus.label}
            </button>
            <button
              onClick={handleReset}
              disabled={busyAction !== null}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs font-medium text-slate-300 hover:border-slate-500 disabled:opacity-50"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${busyAction === "reset" ? "animate-spin" : ""}`} />
              Reset Epoch #1
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        {/* Alert Banner */}
        {banner && (
          <div
            className={`mb-5 flex items-start gap-2.5 rounded-xl border px-4 py-3 text-sm ${
              banner.kind === "ok"
                ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200"
                : banner.kind === "err"
                  ? "border-rose-500/40 bg-rose-500/10 text-rose-200"
                  : "border-indigo-500/40 bg-indigo-500/10 text-indigo-200"
            }`}
          >
            {banner.kind === "ok" ? (
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
            ) : banner.kind === "err" ? (
              <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-rose-400" />
            ) : (
              <Terminal className="mt-0.5 h-4 w-4 shrink-0 text-indigo-400" />
            )}
            <span>{banner.text}</span>
          </div>
        )}

        {/* KPI Cards */}
        <section className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-xl border border-slate-800 bg-[#0b101b] p-4">
            <div className="flex items-center justify-between text-xs text-slate-400">
              <span>Public Ledger State</span>
              <Unlock className="h-3.5 w-3.5 text-indigo-400" />
            </div>
            <div className="mt-1.5 flex items-baseline gap-2">
              <span className="font-mono text-2xl font-bold text-white">
                Epoch #{pub?.lastAttestedEpoch ?? "—"}
              </span>
              <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-emerald-300">
                {pub?.lastSolvencyVerified ? "VERIFIED" : "PENDING"}
              </span>
            </div>
            <p className="mt-1 font-mono text-[11px] text-slate-500">
              Attestations: {pub?.attestationCount ?? "0"} · Next Epoch #{pub?.epoch ?? "1"}
            </p>
          </div>

          <div className="rounded-xl border border-slate-800 bg-[#0b101b] p-4">
            <div className="flex items-center justify-between text-xs text-slate-400">
              <span>Private Reserve Ratio</span>
              <EyeOff className="h-3.5 w-3.5 text-emerald-400" />
            </div>
            <div className="mt-1.5 flex items-baseline gap-2">
              <span
                className={`font-mono text-2xl font-bold ${
                  liveRatioPct >= minRatioPct ? "text-emerald-400" : "text-rose-400"
                }`}
              >
                {liveRatioPct.toFixed(2)}%
              </span>
              <span className="font-mono text-xs text-slate-400">≥ {minRatioPct.toFixed(1)}%</span>
            </div>
            <p className="mt-1 text-[11px] text-slate-500">
              Held locally ({formatUsd(liveTotal)} vs {formatUsd(liveLiab)}) · 0 bytes on-chain
            </p>
          </div>

          <div className="rounded-xl border border-slate-800 bg-[#0b101b] p-4">
            <div className="flex items-center justify-between text-xs text-slate-400">
              <span>Max Single Custodian</span>
              <Lock className="h-3.5 w-3.5 text-amber-400" />
            </div>
            <div className="mt-1.5 flex items-baseline gap-2">
              <span
                className={`font-mono text-2xl font-bold ${
                  liveMaxSharePct <= maxSinglePct ? "text-slate-100" : "text-rose-400"
                }`}
              >
                {liveMaxSharePct.toFixed(2)}%
              </span>
              <span className="font-mono text-xs text-slate-400">≤ {maxSinglePct.toFixed(1)}%</span>
            </div>
            <p className="mt-1 text-[11px] text-slate-500">
              Prevents hidden single-venue trap inside aggregate solvency proofs
            </p>
          </div>

          <div className="rounded-xl border border-slate-800 bg-[#0b101b] p-4">
            <div className="flex items-center justify-between text-xs text-slate-400">
              <span>Anti-Replay & Grants</span>
              <KeyRound className="h-3.5 w-3.5 text-cyan-400" />
            </div>
            <div className="mt-1.5 font-mono text-2xl font-bold text-white">
              {pub?.usedNullifiersCount ?? "0"} <span className="text-sm font-normal text-slate-400">nullifiers</span> ·{" "}
              {pub?.auditorGrantsCount ?? "0"} <span className="text-sm font-normal text-slate-400">grants</span>
            </div>
            <p className="mt-1 font-mono text-[11px] text-slate-500">
              Root: {shortHex(pub?.lastSolvencyRoot ?? "0x0", 10, 6)}
            </p>
          </div>
        </section>

        {/* Navigation Tabs */}
        <nav className="mb-6 flex flex-wrap gap-2 border-b border-slate-800 pb-3">
          {[
            { id: "studio" as const, label: "1. Dual-Ledger Proof Studio", icon: ShieldCheck },
            { id: "covenant" as const, label: "2. Covenant Policy & Attacks", icon: AlertTriangle },
            { id: "auditor" as const, label: "3. Selective Auditor Disclosure", icon: Eye },
            { id: "artifacts" as const, label: "4. Compact Contract & ZKIR", icon: Code2 }
          ].map((item) => {
            const Icon = item.icon;
            const active = tab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setTab(item.id)}
                className={`inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-xs font-semibold transition ${
                  active
                    ? "border border-indigo-500/50 bg-indigo-500/20 text-indigo-200"
                    : "border border-slate-800 bg-[#0b101b] text-slate-400 hover:border-slate-700 hover:text-slate-200"
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                {item.label}
              </button>
            );
          })}
        </nav>

        {loading && !session ? (
          <div className="rounded-xl border border-slate-800 bg-[#0b101b] p-12 text-center text-sm text-slate-400">
            Booting Midnight Ledger 9 WASM Runtime & Compact Contract State...
          </div>
        ) : (
          <>
            {/* TAB 1: Dual-Ledger Proof Studio */}
            {tab === "studio" && (
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
                {/* LEFT COLUMN: Private Witness Vault */}
                <div className="space-y-4 lg:col-span-6">
                  <div className="rounded-xl border border-emerald-500/30 bg-[#0b101b] p-5">
                    <div className="mb-4 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <EyeOff className="h-4 w-4 text-emerald-400" />
                        <h2 className="text-sm font-bold text-white">
                          Private Witness Vault (Local Prover Only)
                        </h2>
                      </div>
                      <span className="rounded border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 font-mono text-[10px] font-semibold text-emerald-300">
                        NEVER ON-CHAIN
                      </span>
                    </div>

                    {/* 1-click Scenarios */}
                    <div className="mb-4">
                      <p className="mb-2 text-[11px] font-medium uppercase tracking-wider text-slate-400">
                        One-Click ZK Verification & Rejection Scenarios
                      </p>
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                        <button
                          disabled={busyAction !== null}
                          onClick={() =>
                            handleAttest({
                              balances: ["3200000", "3100000", "2900000", "2800000"],
                              liabilities: "8000000",
                              autoFresh: true,
                              label: "preset-pass"
                            })
                          }
                          className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-left text-xs hover:bg-emerald-500/20 disabled:opacity-50"
                        >
                          <div className="font-semibold text-emerald-300">Healthy Diversified ($12M/$8M)</div>
                          <div className="text-[11px] text-slate-400">150% ratio, ≤26.7% venue -&gt; PASS</div>
                        </button>

                        <button
                          disabled={busyAction !== null}
                          onClick={() =>
                            handleAttest({
                              balances: ["2400000", "2300000", "2200000", "2100000"],
                              liabilities: "8000000",
                              autoFresh: true,
                              label: "preset-solvency-fail"
                            })
                          }
                          className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-left text-xs hover:bg-rose-500/20 disabled:opacity-50"
                        >
                          <div className="font-semibold text-rose-300">Undercollateralized ($9M/$8M)</div>
                          <div className="text-[11px] text-slate-400">112.5% &lt; 120% cap -&gt; ZK REJECT</div>
                        </button>

                        <button
                          disabled={busyAction !== null}
                          onClick={() =>
                            handleAttest({
                              balances: ["7500000", "1500000", "1500000", "1500000"],
                              liabilities: "8000000",
                              autoFresh: true,
                              label: "preset-concentration-fail"
                            })
                          }
                          className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-left text-xs hover:bg-amber-500/20 disabled:opacity-50"
                        >
                          <div className="font-semibold text-amber-300">Concentration Trap (62.5% on C0)</div>
                          <div className="text-[11px] text-slate-400">150% solvent BUT &gt;40% cap -&gt; ZK REJECT</div>
                        </button>

                        <button
                          disabled={busyAction !== null}
                          onClick={() =>
                            handleAttest({
                              balances: ["3200000", "3100000", "2900000", "2800000"],
                              liabilities: "8000000",
                              autoFresh: false,
                              saltHex: "0x" + "55".repeat(32),
                              label: "preset-replay"
                            })
                          }
                          className="rounded-lg border border-indigo-500/30 bg-indigo-500/10 px-3 py-2 text-left text-xs hover:bg-indigo-500/20 disabled:opacity-50"
                        >
                          <div className="font-semibold text-indigo-300">Fixed-Salt Nullifier Test</div>
                          <div className="text-[11px] text-slate-400">Click twice w/ same epoch to test replay</div>
                        </button>
                      </div>
                    </div>

                    {/* Editable Private Inputs */}
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      {(priv?.custodianLabels ?? [
                        "Fireblocks Vault",
                        "Coinbase Prime Cold",
                        "Anchorage Digital",
                        "Copper ClearLoop"
                      ]).map((lbl, idx) => (
                        <label key={lbl} className="block">
                          <span className="mb-1 block text-[11px] font-medium text-slate-400">
                            {lbl} (USD Private Witness b[{idx}])
                          </span>
                          <input
                            type="number"
                            min={0}
                            step={50000}
                            value={balances[idx]}
                            onChange={(e) => {
                              const next = [...balances] as [string, string, string, string];
                              next[idx] = e.target.value;
                              setBalances(next);
                            }}
                            className="w-full rounded-lg border border-slate-700 bg-[#07090f] px-3 py-2 font-mono text-xs text-slate-100 focus:border-indigo-500 focus:outline-none"
                          />
                        </label>
                      ))}
                    </div>

                    <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <label className="block">
                        <span className="mb-1 block text-[11px] font-medium text-slate-400">
                          Total Client Liabilities (USD Private Witness)
                        </span>
                        <input
                          type="number"
                          min={1}
                          step={50000}
                          value={liabilities}
                          onChange={(e) => setLiabilities(e.target.value)}
                          className="w-full rounded-lg border border-slate-700 bg-[#07090f] px-3 py-2 font-mono text-xs text-slate-100 focus:border-indigo-500 focus:outline-none"
                        />
                      </label>

                      <div className="flex flex-col justify-end">
                        <label className="mb-1.5 flex items-center gap-2 text-xs text-slate-300">
                          <input
                            type="checkbox"
                            checked={autoFreshSalt}
                            onChange={(e) => setAutoFreshSalt(e.target.checked)}
                            className="rounded border-slate-600 bg-slate-900 text-indigo-500"
                          />
                          Auto-generate fresh 32-byte epoch blinding salt
                        </label>
                        {!autoFreshSalt && (
                          <input
                            type="text"
                            value={manualSaltHex}
                            onChange={(e) => setManualSaltHex(e.target.value)}
                            placeholder="0x... (32 bytes)"
                            className="w-full rounded-lg border border-slate-700 bg-[#07090f] px-2.5 py-1.5 font-mono text-[11px] text-slate-200"
                          />
                        )}
                      </div>
                    </div>

                    <button
                      disabled={busyAction !== null}
                      onClick={() => handleAttest()}
                      className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-2.5 text-xs font-bold text-white transition hover:bg-indigo-500 disabled:opacity-50"
                    >
                      <ShieldCheck className="h-4 w-4" />
                      {busyAction === "attest"
                        ? "Executing Compact ZK Circuit..."
                        : `Execute Compact Circuit attestSolvency() for Epoch #${pub?.epoch ?? "1"}`}
                    </button>
                  </div>

                  <VaultDiagram
                    labels={
                      priv?.custodianLabels ?? [
                        "Fireblocks Vault",
                        "Coinbase Prime Cold",
                        "Anchorage Digital",
                        "Copper ClearLoop"
                      ]
                    }
                    balancesUsd={balances}
                    maxCapBps={pub?.covenantMaxSingleBps ?? "4000"}
                  />
                </div>

                {/* RIGHT COLUMN: Public Midnight Ledger 9 State */}
                <div className="space-y-4 lg:col-span-6">
                  <div className="rounded-xl border border-indigo-500/30 bg-[#0b101b] p-5">
                    <div className="mb-4 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Unlock className="h-4 w-4 text-indigo-400" />
                        <h2 className="text-sm font-bold text-white">
                          Public Midnight Ledger 9 State
                        </h2>
                      </div>
                      <span className="rounded border border-indigo-500/30 bg-indigo-500/10 px-2 py-0.5 font-mono text-[10px] font-semibold text-indigo-300">
                        EXPLICIT disclose(...) ONLY
                      </span>
                    </div>

                    <div className="divide-y divide-slate-800/80 rounded-lg border border-slate-800 bg-[#07090f] px-3">
                      {[
                        ["contractAddress", shortHex(pub?.contractAddress ?? "", 14, 10)],
                        ["epoch (Counter)", pub?.epoch ?? "1"],
                        ["attestationCount (Counter)", pub?.attestationCount ?? "0"],
                        ["entityCommitment", shortHex(pub?.entityCommitment ?? "", 16, 10)],
                        ["covenantMinRatioBps", `${pub?.covenantMinRatioBps ?? "12000"} bps (${minRatioPct.toFixed(2)}%)`],
                        ["covenantMaxSingleBps", `${pub?.covenantMaxSingleBps ?? "4000"} bps (${maxSinglePct.toFixed(2)}%)`],
                        ["lastSolvencyRoot", shortHex(pub?.lastSolvencyRoot ?? "", 16, 10)],
                        ["lastSolvencyVerified", String(pub?.lastSolvencyVerified ?? false).toUpperCase()],
                        ["lastAttestedEpoch", pub?.lastAttestedEpoch ?? "0"],
                        ["usedNullifiers.size()", pub?.usedNullifiersCount ?? "0"],
                        ["auditorGrants.size()", pub?.auditorGrantsCount ?? "0"]
                      ].map(([field, value]) => (
                        <div key={field} className="flex items-center justify-between gap-4 py-2 text-xs">
                          <span className="font-mono text-slate-400">{field}</span>
                          <span className="font-mono font-medium text-slate-100">{value}</span>
                        </div>
                      ))}
                    </div>

                    <div className="mt-3 rounded-lg border border-emerald-500/25 bg-emerald-500/5 px-3 py-2 text-[11px] text-emerald-200">
                      <span className="font-semibold text-emerald-300">Zero-Leakage Audit:</span> Public state contains{" "}
                      <span className="font-mono font-bold">0</span> USD balances,{" "}
                      <span className="font-mono font-bold">0</span> counterparty names, and{" "}
                      <span className="font-mono font-bold">0</span> liability figures.
                    </div>
                  </div>

                  {/* Circuit Execution Log */}
                  <div className="rounded-xl border border-slate-800 bg-[#0b101b] p-5">
                    <h3 className="mb-3 text-xs font-bold uppercase tracking-wider text-slate-300">
                      Midnight Circuit Execution History
                    </h3>
                    <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
                      {(session?.history ?? []).map((ev) => (
                        <div
                          key={ev.id}
                          className={`rounded-lg border p-3 text-xs ${
                            ev.status === "VERIFIED"
                              ? "border-emerald-500/25 bg-emerald-500/5"
                              : "border-rose-500/30 bg-rose-500/5"
                          }`}
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="font-mono font-semibold text-white">
                              {ev.circuit}() ·{" "}
                              <span className={ev.status === "VERIFIED" ? "text-emerald-300" : "text-rose-300"}>
                                {ev.status}
                              </span>
                            </span>
                            <span className="font-mono text-[10px] text-slate-400">
                              Epoch {ev.epochBefore} → {ev.epochAfter} · {ev.durationMs}ms · Leaked:{" "}
                              {ev.privateFieldsLeaked}
                            </span>
                          </div>
                          <p className="mt-1 text-slate-300">{ev.message}</p>
                          {ev.reserveRootHex && (
                            <p className="mt-1 font-mono text-[10px] text-indigo-300">
                              Root: {shortHex(ev.reserveRootHex, 16, 10)}
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* TAB 2: Covenant Policy & Adversarial Tests */}
            {tab === "covenant" && (
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                <form
                  onSubmit={handleTightenPolicy}
                  className="rounded-xl border border-slate-800 bg-[#0b101b] p-6"
                >
                  <h2 className="mb-1 text-base font-bold text-white">
                    On-Chain Covenant Policy Governance (`tightenCovenantPolicy`)
                  </h2>
                  <p className="mb-4 text-xs text-slate-400">
                    Authorized exclusively by the entity holding `localDeskSecret()` matching on-chain `entityCommitment`. Subsequent `attestSolvency()` proofs must satisfy the updated thresholds in zero knowledge.
                  </p>

                  <div className="space-y-4">
                    <label className="block">
                      <span className="mb-1 block text-xs font-medium text-slate-300">
                        Minimum Reserve Ratio (bps, ≥ 10000 = 100.00%)
                      </span>
                      <input
                        type="number"
                        value={policyMinRatioBps}
                        onChange={(e) => setPolicyMinRatioBps(e.target.value)}
                        className="w-full rounded-lg border border-slate-700 bg-[#07090f] px-3 py-2 font-mono text-xs text-white"
                      />
                    </label>

                    <label className="block">
                      <span className="mb-1 block text-xs font-medium text-slate-300">
                        Maximum Single-Custodian Concentration (bps, 1000..10000)
                      </span>
                      <input
                        type="number"
                        value={policyMaxSingleBps}
                        onChange={(e) => setPolicyMaxSingleBps(e.target.value)}
                        className="w-full rounded-lg border border-slate-700 bg-[#07090f] px-3 py-2 font-mono text-xs text-white"
                      />
                    </label>

                    <div className="flex flex-wrap gap-2">
                      <button
                        type="submit"
                        disabled={busyAction !== null}
                        className="rounded-lg bg-indigo-600 px-4 py-2 text-xs font-bold text-white hover:bg-indigo-500 disabled:opacity-50"
                      >
                        Update Covenant via Compact Circuit
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setPolicyMinRatioBps("9500");
                        }}
                        className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs font-medium text-rose-300 hover:bg-rose-500/20"
                      >
                        Preset Invalid (&lt;100% Ratio)
                      </button>
                    </div>
                  </div>
                </form>

                <div className="rounded-xl border border-rose-500/30 bg-[#0b101b] p-6">
                  <div className="mb-2 flex items-center gap-2">
                    <ShieldAlert className="h-5 w-5 text-rose-400" />
                    <h2 className="text-base font-bold text-white">
                      Adversarial Circuit Self-Test
                    </h2>
                  </div>
                  <p className="mb-4 text-xs text-slate-400">
                    Test the compiled Compact assertion `assert(entityCommitment == deriveEntityCommitment(sk))` directly by substituting an unauthorized 32-byte key into the private witness context.
                  </p>

                  <div className="mb-4 rounded-lg border border-slate-800 bg-[#07090f] p-3 font-mono text-[11px] text-slate-300">
                    <div>Expected entityCommitment: {shortHex(pub?.entityCommitment ?? "", 18, 10)}</div>
                    <div className="mt-1 text-rose-300">
                      Attacker sk: randomBytes(32) -&gt; deriveEntityCommitment(attackerSk) != entityCommitment
                    </div>
                  </div>

                  <button
                    onClick={handleRogueKeyAttack}
                    disabled={busyAction !== null}
                    className="inline-flex items-center gap-2 rounded-lg border border-rose-500/50 bg-rose-600/20 px-4 py-2.5 text-xs font-bold text-rose-200 hover:bg-rose-600/30 disabled:opacity-50"
                  >
                    <ShieldAlert className="h-4 w-4" />
                    Execute Rogue Key Attack Simulation
                  </button>
                </div>
              </div>
            )}

            {/* TAB 3: Selective Auditor Disclosure & Independent Verifier */}
            {tab === "auditor" && (
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
                {/* Grant Form & List */}
                <div className="space-y-4 lg:col-span-5">
                  <form
                    onSubmit={handleGrantAuditor}
                    className="rounded-xl border border-indigo-500/30 bg-[#0b101b] p-5"
                  >
                    <h2 className="mb-1 text-sm font-bold text-white">
                      Grant Selective Epoch Disclosure (`grantAuditorDisclosure`)
                    </h2>
                    <p className="mb-4 text-xs text-slate-400">
                      Publishes an epoch-scoped keyed tag in public `auditorGrants` so a named regulator can verify one historical snapshot without unlocking any other epoch.
                    </p>

                    <div className="space-y-3">
                      <label className="block">
                        <span className="mb-1 block text-[11px] font-medium text-slate-300">
                          Auditor Identifier / 32-Byte Hex Key
                        </span>
                        <input
                          type="text"
                          value={auditorLabel}
                          onChange={(e) => setAuditorLabel(e.target.value)}
                          className="w-full rounded-lg border border-slate-700 bg-[#07090f] px-3 py-2 font-mono text-xs text-white"
                        />
                      </label>
                      <label className="block">
                        <span className="mb-1 block text-[11px] font-medium text-slate-300">
                          Target Attested Epoch (1 .. {pub?.lastAttestedEpoch ?? "1"})
                        </span>
                        <input
                          type="number"
                          min={1}
                          value={targetEpoch}
                          onChange={(e) => setTargetEpoch(e.target.value)}
                          className="w-full rounded-lg border border-slate-700 bg-[#07090f] px-3 py-2 font-mono text-xs text-white"
                        />
                      </label>
                      <button
                        type="submit"
                        disabled={busyAction !== null}
                        className="w-full rounded-lg bg-indigo-600 px-4 py-2 text-xs font-bold text-white hover:bg-indigo-500 disabled:opacity-50"
                      >
                        Publish Auditor Disclosure Grant
                      </button>
                    </div>
                  </form>

                  <div className="rounded-xl border border-slate-800 bg-[#0b101b] p-5">
                    <h3 className="mb-3 text-xs font-bold uppercase tracking-wider text-slate-300">
                      On-Chain `auditorGrants` Registry ({session?.grants.length ?? 0})
                    </h3>
                    <div className="space-y-2">
                      {(session?.grants ?? []).map((g) => (
                        <div
                          key={g.grantKeyHex}
                          className="rounded-lg border border-slate-800 bg-[#07090f] p-3 text-xs"
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-semibold text-indigo-300">{g.auditorLabel}</span>
                            <span className="font-mono text-[10px] text-emerald-300">
                              Epoch #{g.targetEpoch} · ON-LEDGER
                            </span>
                          </div>
                          <div className="mt-1 font-mono text-[10px] text-slate-400">
                            GrantKey: {shortHex(g.grantKeyHex, 14, 10)}
                          </div>
                          <div className="font-mono text-[10px] text-slate-500">
                            Tag: {shortHex(g.disclosureTagHex, 14, 10)}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Independent Third-Party Auditor Verifier */}
                <div className="rounded-xl border border-emerald-500/30 bg-[#0b101b] p-5 lg:col-span-7">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h2 className="text-sm font-bold text-white">
                        Independent Auditor Cryptographic Verifier
                      </h2>
                      <p className="text-xs text-slate-400">
                        Auditor receives off-chain reserve preimage privately, then runs Compact pure circuits `computeGrantKey` &amp; `computeReserveRoot` against Midnight ledger state.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        if (!priv || !pub) return;
                        const firstGrant = session?.grants[0];
                        setVerifyLabel(firstGrant?.auditorLabel ?? "finra-institutional-audit-2026");
                        setVerifyEpoch(pub.lastAttestedEpoch || "1");
                        setVerifyBalances([...priv.custodianBalancesUsd]);
                        setVerifyLiabilities(priv.totalLiabilitiesUsd);
                        setVerifySaltHex(priv.epochSaltHex);
                      }}
                      className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-[11px] font-semibold text-emerald-300 hover:bg-emerald-500/20"
                    >
                      Load Current Private Packet
                    </button>
                  </div>

                  <form onSubmit={handleVerifyPacket} className="space-y-3">
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <label className="block">
                        <span className="mb-1 block text-[11px] text-slate-400">Auditor Label / PK</span>
                        <input
                          type="text"
                          value={verifyLabel}
                          onChange={(e) => setVerifyLabel(e.target.value)}
                          className="w-full rounded-lg border border-slate-700 bg-[#07090f] px-3 py-1.5 font-mono text-xs text-white"
                        />
                      </label>
                      <label className="block">
                        <span className="mb-1 block text-[11px] text-slate-400">Epoch</span>
                        <input
                          type="number"
                          value={verifyEpoch}
                          onChange={(e) => setVerifyEpoch(e.target.value)}
                          className="w-full rounded-lg border border-slate-700 bg-[#07090f] px-3 py-1.5 font-mono text-xs text-white"
                        />
                      </label>
                    </div>

                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                      {verifyBalances.map((val, idx) => (
                        <label key={idx} className="block">
                          <span className="mb-1 block text-[10px] text-slate-400">Custodian b[{idx}]</span>
                          <input
                            type="number"
                            value={val}
                            onChange={(e) => {
                              const next = [...verifyBalances] as [string, string, string, string];
                              next[idx] = e.target.value;
                              setVerifyBalances(next);
                            }}
                            className="w-full rounded-lg border border-slate-700 bg-[#07090f] px-2 py-1.5 font-mono text-xs text-white"
                          />
                        </label>
                      ))}
                    </div>

                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <label className="block">
                        <span className="mb-1 block text-[11px] text-slate-400">Off-Chain Liabilities</span>
                        <input
                          type="number"
                          value={verifyLiabilities}
                          onChange={(e) => setVerifyLiabilities(e.target.value)}
                          className="w-full rounded-lg border border-slate-700 bg-[#07090f] px-3 py-1.5 font-mono text-xs text-white"
                        />
                      </label>
                      <label className="block">
                        <span className="mb-1 block text-[11px] text-slate-400">Off-Chain Blinding Salt Hex</span>
                        <input
                          type="text"
                          value={verifySaltHex}
                          onChange={(e) => setVerifySaltHex(e.target.value)}
                          className="w-full rounded-lg border border-slate-700 bg-[#07090f] px-3 py-1.5 font-mono text-[11px] text-white"
                        />
                      </label>
                    </div>

                    <button
                      type="submit"
                      disabled={busyAction !== null}
                      className="w-full rounded-lg bg-emerald-600 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-500 disabled:opacity-50"
                    >
                      Verify Disclosure Preimage Against Public Ledger
                    </button>
                  </form>

                  {verification && (
                    <div
                      className={`mt-4 rounded-xl border p-4 text-xs ${
                        verification.verified
                          ? "border-emerald-500/40 bg-emerald-500/10"
                          : "border-rose-500/40 bg-rose-500/10"
                      }`}
                    >
                      <div className="mb-2 flex items-center justify-between font-bold">
                        <span className={verification.verified ? "text-emerald-300" : "text-rose-300"}>
                          {verification.verified
                            ? "AUTHENTICATED AUDIT DISCLOSURE"
                            : "VERIFICATION MISMATCH"}
                        </span>
                        <span className="font-mono text-[11px] text-slate-300">
                          Solvency {verification.auditedSolvencyPct} · Max Venue {verification.auditedMaxCustodianPct}
                        </span>
                      </div>
                      <div className="space-y-1 font-mono text-[11px] text-slate-300">
                        <div>Grant on Ledger: {String(verification.grantOnLedger).toUpperCase()}</div>
                        <div>Latest Root Match: {String(verification.rootMatchesLatest).toUpperCase()}</div>
                        <div>Recomputed Root: {shortHex(verification.recomputedRoot, 18, 12)}</div>
                        <div>Ledger Root: {shortHex(verification.ledgerRootHex, 18, 12)}</div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* TAB 4: Compact Source & ZKIR Inspector */}
            {tab === "artifacts" && artifacts && (
              <div className="space-y-6">
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-800 bg-[#0b101b] p-4">
                  <div className="flex items-center gap-3">
                    <FileCode2 className="h-5 w-5 text-indigo-400" />
                    <div>
                      <div className="text-sm font-bold text-white">
                        Compiled by Midnight compactc {artifacts.compilerVersion}
                      </div>
                      <div className="font-mono text-xs text-slate-400">
                        Language {artifacts.languageVersion} · Runtime {artifacts.runtimeVersion} · {artifacts.ledgerVersion}
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={downloadPreprodBundle}
                    className="rounded-lg border border-indigo-500/40 bg-indigo-500/15 px-3.5 py-2 text-xs font-semibold text-indigo-200 hover:bg-indigo-500/25"
                  >
                    Export Preprod Bundle JSON
                  </button>
                </div>

                {/* Circuit Artifacts Grid */}
                <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                  {artifacts.circuits
                    .filter((c) => !c.pure)
                    .map((c) => (
                      <div key={c.name} className="rounded-xl border border-slate-800 bg-[#0b101b] p-4">
                        <div className="flex items-center justify-between">
                          <span className="font-mono text-sm font-bold text-indigo-300">{c.name}()</span>
                          <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 font-mono text-[10px] text-emerald-300">
                            ZK PROOF CIRCUIT
                          </span>
                        </div>
                        <div className="mt-2 space-y-1 font-mono text-[11px] text-slate-300">
                          <div>ZKIR: {c.zkirFile} ({c.zkirLines} lines / {(c.zkirBytes / 1024).toFixed(1)} KB)</div>
                          <div>Prover Key: {(c.proverBytes / (1024 * 1024)).toFixed(1)} MB</div>
                          <div>Verifier Key: {c.verifierBytes} B</div>
                          <div className="text-slate-400">
                            Verifier SHA-256: {c.verifierSha256 ? shortHex("0x" + c.verifierSha256, 14, 10) : "n/a"}
                          </div>
                        </div>
                        <div className="mt-3 flex flex-wrap gap-1.5">
                          {Object.entries(c.zkirOps)
                            .slice(0, 6)
                            .map(([op, count]) => (
                              <span
                                key={op}
                                className="rounded border border-slate-700 bg-[#07090f] px-2 py-0.5 font-mono text-[10px] text-slate-300"
                              >
                                {op}:{count}
                              </span>
                            ))}
                        </div>
                      </div>
                    ))}
                </div>

                {/* Source Viewer */}
                <div className="rounded-xl border border-slate-800 bg-[#0b101b] p-4">
                  <div className="mb-2 flex items-center justify-between text-xs text-slate-400">
                    <span className="font-mono font-semibold text-slate-200">
                      contract/src/zero_covenant.compact ({artifacts.sourceLines} lines)
                    </span>
                    <span>Apache-2.0 Licensed</span>
                  </div>
                  <pre className="max-h-96 overflow-auto rounded-lg border border-slate-800 bg-[#05070c] p-4 font-mono text-[11px] leading-relaxed text-slate-300">
                    {artifacts.sourceCode}
                  </pre>
                </div>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
