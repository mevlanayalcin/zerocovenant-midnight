import { Hono } from "hono";
import { cors } from "hono/cors";
import { loadCompiledArtifacts } from "./artifacts.js";
import {
  getExistingSession,
  initIsolatedSession,
  resetAuthenticatedSession
} from "./engine.js";

const U64_MAX = 18_446_744_073_709_551_615n;

const ALLOWED_ORIGINS = new Set([
  "https://zerocovenant.mevlanayalcin.com.tr",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:8790",
  "http://127.0.0.1:8790"
]);

function parseUint64(value: unknown, field: string): bigint {
  if (typeof value === "bigint") {
    if (value < 0n || value > U64_MAX) throw new Error(`${field} out of Uint<64> bounds`);
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value) || !Number.isInteger(value) || value < 0) {
      throw new Error(`${field} must be a non-negative integer`);
    }
    const big = BigInt(value);
    if (big > U64_MAX) throw new Error(`${field} out of Uint<64> bounds`);
    return big;
  }
  if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    const big = BigInt(value.trim());
    if (big > U64_MAX) throw new Error(`${field} out of Uint<64> bounds`);
    return big;
  }
  throw new Error(`Invalid Uint<64> for ${field}`);
}

export function createZeroCovenantApp(): Hono {
  const app = new Hono();

  app.use(
    "/api/*",
    cors({
      origin: (origin) => {
        if (!origin) return "";
        return ALLOWED_ORIGINS.has(origin) ? origin : "";
      },
      allowMethods: ["GET", "POST", "OPTIONS"],
      allowHeaders: ["Content-Type", "X-Session-Token"]
    })
  );

  app.get("/health", async (c) => {
    const artifacts = loadCompiledArtifacts();
    return c.json({
      ok: true,
      service: "ZeroCovenant",
      network: "Midnight Ledger 9 WASM Runtime (Local Compact Prover)",
      compilerVersion: artifacts.compilerVersion,
      languageVersion: artifacts.languageVersion,
      runtimeVersion: artifacts.runtimeVersion,
      circuits: artifacts.circuits.length,
      timestamp: new Date().toISOString()
    });
  });

  app.get("/api/v1/artifacts", (c) => {
    return c.json(loadCompiledArtifacts());
  });

  app.get("/api/v1/openapi.json", (c) => {
    return c.json({
      openapi: "3.1.0",
      info: {
        title: "ZeroCovenant Midnight Proof-of-Solvency API",
        version: "2.0.0",
        description:
          "Dual-ledger institutional Proof-of-Solvency, Concentration Risk Covenant & Selective Auditor Disclosure powered by compiled Midnight Compact smart contracts. Public ledger reads expose zero private witness fields; mutations require per-session X-Session-Token authentication."
      },
      paths: {
        "/health": { get: { summary: "Service and Midnight Compact compiler health" } },
        "/api/v1/artifacts": { get: { summary: "Compiled Compact source, ZKIR instruction breakdown, and verifier key hashes" } },
        "/api/v1/session/init": { post: { summary: "Create an isolated per-visitor session with CSPRNG deskSecret and auth token" } },
        "/api/v1/session": { get: { summary: "Inspect PUBLIC Midnight ledger snapshot only (zero private witness fields)" } },
        "/api/v1/session/reset": { post: { summary: "Authenticated reset of isolated session back to seeded Epoch 1 state" } },
        "/api/v1/attest": { post: { summary: "Authenticated execution of compiled Compact attestSolvency circuit" } },
        "/api/v1/attack/rogue-key": { post: { summary: "Authenticated negative test verifying Compact rejects unauthorized desk secret key" } },
        "/api/v1/disclosure/grant": { post: { summary: "Authenticated execution of grantAuditorDisclosure (one-way root-bound tag)" } },
        "/api/v1/disclosure/verify": { post: { summary: "Public independent auditor verification against historical epochRoots & auditorGrants" } },
        "/api/v1/policy/tighten": { post: { summary: "Authenticated monotonic tightening of on-chain solvency and concentration covenants" } }
      }
    });
  });

  app.post("/api/v1/session/init", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { deskName?: string };
    const created = await initIsolatedSession(body.deskName);
    return c.json({
      ok: true,
      sessionId: created.session.sessionId,
      sessionToken: created.sessionToken,
      initialClientSeed: created.initialClientSeed,
      session: created.session.publicSnapshot(),
      artifactsSummary: loadCompiledArtifacts().circuits.map((x) => ({
        name: x.name,
        pure: x.pure,
        proof: x.proof,
        zkirLines: x.zkirLines,
        verifierSha256: x.verifierSha256
      }))
    });
  });

  app.get("/api/v1/session", (c) => {
    const sessionId = c.req.query("sessionId") || "";
    const session = getExistingSession(sessionId);
    if (!session) {
      return c.json(
        { ok: false, error: "Session not found. Initialize an isolated desk session via POST /api/v1/session/init." },
        404
      );
    }
    return c.json({
      session: session.publicSnapshot(),
      artifactsSummary: loadCompiledArtifacts().circuits.map((x) => ({
        name: x.name,
        pure: x.pure,
        proof: x.proof,
        zkirLines: x.zkirLines,
        verifierSha256: x.verifierSha256
      }))
    });
  });

  app.post("/api/v1/session/reset", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { sessionId?: string };
    const token = c.req.header("X-Session-Token") ?? c.req.header("x-session-token");
    if (!body.sessionId) {
      return c.json({ ok: false, error: "sessionId is required" }, 400);
    }
    const reset = await resetAuthenticatedSession(body.sessionId, token);
    if (!reset) {
      return c.json({ ok: false, error: "Unauthorized or unknown session" }, 401);
    }
    return c.json({
      ok: true,
      sessionId: reset.session.sessionId,
      sessionToken: reset.sessionToken,
      initialClientSeed: reset.initialClientSeed,
      session: reset.session.publicSnapshot()
    });
  });

  app.post("/api/v1/attest", async (c) => {
    try {
      const body = (await c.req.json()) as {
        sessionId?: string;
        custodianBalances?: unknown[];
        totalLiabilities?: unknown;
        epochSaltHex?: string;
        autoFreshSalt?: boolean;
      };
      const token = c.req.header("X-Session-Token") ?? c.req.header("x-session-token");
      const session = body.sessionId ? getExistingSession(body.sessionId) : null;
      if (!session || !session.verifySessionToken(token)) {
        return c.json({ ok: false, error: "Unauthorized or unknown session" }, 401);
      }

      if (!Array.isArray(body.custodianBalances) || body.custodianBalances.length !== 4) {
        return c.json({ ok: false, error: "custodianBalances must be a 4-element tuple" }, 400);
      }

      const b0 = parseUint64(body.custodianBalances[0], "custodianBalances[0]");
      const b1 = parseUint64(body.custodianBalances[1], "custodianBalances[1]");
      const b2 = parseUint64(body.custodianBalances[2], "custodianBalances[2]");
      const b3 = parseUint64(body.custodianBalances[3], "custodianBalances[3]");
      const totalLiabilities = parseUint64(body.totalLiabilities, "totalLiabilities");

      const result = await session.runAttestSolvency({
        custodianBalances: [b0, b1, b2, b3],
        totalLiabilities,
        epochSaltHex: body.epochSaltHex,
        autoFreshSalt: body.autoFreshSalt ?? true
      });
      return c.json(result, result.ok ? 200 : 422);
    } catch (err) {
      return c.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 400);
    }
  });

  app.post("/api/v1/attack/rogue-key", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { sessionId?: string };
    const token = c.req.header("X-Session-Token") ?? c.req.header("x-session-token");
    const session = body.sessionId ? getExistingSession(body.sessionId) : null;
    if (!session || !session.verifySessionToken(token)) {
      return c.json({ ok: false, error: "Unauthorized or unknown session" }, 401);
    }
    const result = await session.simulateRogueKeyAttack();
    return c.json(result, 200);
  });

  app.post("/api/v1/disclosure/grant", async (c) => {
    try {
      const body = (await c.req.json()) as {
        sessionId?: string;
        auditorLabel?: string;
        targetEpoch?: unknown;
      };
      const token = c.req.header("X-Session-Token") ?? c.req.header("x-session-token");
      const session = body.sessionId ? getExistingSession(body.sessionId) : null;
      if (!session || !session.verifySessionToken(token)) {
        return c.json({ ok: false, error: "Unauthorized or unknown session" }, 401);
      }

      const auditorLabel = String(body.auditorLabel ?? "").trim();
      if (!auditorLabel) {
        return c.json({ ok: false, error: "auditorLabel is required" }, 400);
      }
      const targetEpoch =
        body.targetEpoch !== undefined && body.targetEpoch !== ""
          ? parseUint64(body.targetEpoch, "targetEpoch")
          : undefined;
      const res = await session.grantAuditor({ auditorLabel, targetEpoch });
      return c.json(res, res.ok ? 200 : 422);
    } catch (err) {
      return c.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 400);
    }
  });

  // Public auditor verification endpoint: reads ONLY public ledger (epochRoots + auditorGrants)
  app.post("/api/v1/disclosure/verify", async (c) => {
    try {
      const body = (await c.req.json()) as {
        sessionId?: string;
        auditorLabel?: string;
        targetEpoch?: unknown;
        custodianBalances?: unknown[];
        totalLiabilities?: unknown;
        epochSaltHex?: string;
      };
      const session = body.sessionId ? getExistingSession(body.sessionId) : null;
      if (!session) {
        return c.json({ ok: false, error: "Session not found" }, 404);
      }
      if (!Array.isArray(body.custodianBalances) || body.custodianBalances.length !== 4) {
        return c.json({ ok: false, error: "custodianBalances must be a 4-element tuple" }, 400);
      }
      const auditorLabel = String(body.auditorLabel ?? "").trim();
      if (!auditorLabel) return c.json({ ok: false, error: "auditorLabel is required" }, 400);
      const targetEpoch = parseUint64(body.targetEpoch, "targetEpoch");
      const b0 = parseUint64(body.custodianBalances[0], "custodianBalances[0]");
      const b1 = parseUint64(body.custodianBalances[1], "custodianBalances[1]");
      const b2 = parseUint64(body.custodianBalances[2], "custodianBalances[2]");
      const b3 = parseUint64(body.custodianBalances[3], "custodianBalances[3]");
      const totalLiabilities = parseUint64(body.totalLiabilities, "totalLiabilities");
      const epochSaltHex = String(body.epochSaltHex ?? "").trim();
      if (!epochSaltHex) return c.json({ ok: false, error: "epochSaltHex is required" }, 400);

      const verification = session.verifyDisclosurePacket({
        auditorLabel,
        targetEpoch,
        custodianBalances: [b0, b1, b2, b3],
        totalLiabilities,
        epochSaltHex
      });
      return c.json({ ok: true, verification });
    } catch (err) {
      return c.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 400);
    }
  });

  app.post("/api/v1/policy/tighten", async (c) => {
    try {
      const body = (await c.req.json()) as {
        sessionId?: string;
        minRatioBps?: unknown;
        maxSingleBps?: unknown;
      };
      const token = c.req.header("X-Session-Token") ?? c.req.header("x-session-token");
      const session = body.sessionId ? getExistingSession(body.sessionId) : null;
      if (!session || !session.verifySessionToken(token)) {
        return c.json({ ok: false, error: "Unauthorized or unknown session" }, 401);
      }

      const minRatioBps = parseUint64(body.minRatioBps, "minRatioBps");
      const maxSingleBps = parseUint64(body.maxSingleBps, "maxSingleBps");
      const res = await session.tightenPolicy({ minRatioBps, maxSingleBps });
      return c.json(res, res.ok ? 200 : 422);
    } catch (err) {
      return c.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 400);
    }
  });

  return app;
}
