import { Hono } from "hono";
import { cors } from "hono/cors";
import { loadCompiledArtifacts } from "./artifacts.js";
import { getOrCreateSession, resetSession } from "./engine.js";

const U64_MAX = 18_446_744_073_709_551_615n;

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

  app.use("/api/*", cors());

  app.get("/health", async (c) => {
    const artifacts = loadCompiledArtifacts();
    return c.json({
      ok: true,
      service: "ZeroCovenant",
      network: "Midnight Ledger 9 (Preprod-Compatible Runtime)",
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
        version: "1.0.0",
        description:
          "Dual-ledger institutional Proof-of-Solvency, Concentration Risk Covenant & Selective Auditor Disclosure powered by compiled Midnight Compact smart contracts."
      },
      paths: {
        "/health": { get: { summary: "Service and Midnight Compact compiler health" } },
        "/api/v1/artifacts": { get: { summary: "Compiled Compact source, ZKIR instruction breakdown, and verifier key hashes" } },
        "/api/v1/session": { get: { summary: "Inspect private witness vault vs public Midnight ledger snapshot" } },
        "/api/v1/session/reset": { post: { summary: "Reset session back to seeded institutional Epoch 1 state" } },
        "/api/v1/attest": { post: { summary: "Execute compiled Compact attestSolvency circuit across private witnesses" } },
        "/api/v1/attack/rogue-key": { post: { summary: "Negative test: verify Compact rejects unauthorized desk secret key" } },
        "/api/v1/disclosure/grant": { post: { summary: "Execute compiled grantAuditorDisclosure circuit for an epoch" } },
        "/api/v1/disclosure/verify": { post: { summary: "Independent auditor pure-circuit verification against public ledger" } },
        "/api/v1/policy/tighten": { post: { summary: "Execute tightenCovenantPolicy circuit to update solvency and concentration caps" } }
      }
    });
  });

  app.get("/api/v1/session", async (c) => {
    const sessionId = c.req.query("sessionId") || "alpha-treasury";
    const session = await getOrCreateSession(sessionId);
    return c.json({
      session: session.snapshot(),
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
    const session = await resetSession(body.sessionId || "alpha-treasury");
    return c.json({ ok: true, session: session.snapshot() });
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
      if (!Array.isArray(body.custodianBalances) || body.custodianBalances.length !== 4) {
        return c.json({ ok: false, error: "custodianBalances must be a 4-element tuple" }, 400);
      }

      const b0 = parseUint64(body.custodianBalances[0], "custodianBalances[0]");
      const b1 = parseUint64(body.custodianBalances[1], "custodianBalances[1]");
      const b2 = parseUint64(body.custodianBalances[2], "custodianBalances[2]");
      const b3 = parseUint64(body.custodianBalances[3], "custodianBalances[3]");
      const totalLiabilities = parseUint64(body.totalLiabilities, "totalLiabilities");

      const session = await getOrCreateSession(body.sessionId || "alpha-treasury");
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
    const session = await getOrCreateSession(body.sessionId || "alpha-treasury");
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
      const auditorLabel = String(body.auditorLabel ?? "").trim();
      if (!auditorLabel) {
        return c.json({ ok: false, error: "auditorLabel is required" }, 400);
      }
      const targetEpoch =
        body.targetEpoch !== undefined && body.targetEpoch !== ""
          ? parseUint64(body.targetEpoch, "targetEpoch")
          : undefined;
      const session = await getOrCreateSession(body.sessionId || "alpha-treasury");
      const res = await session.grantAuditor({ auditorLabel, targetEpoch });
      return c.json(res, res.ok ? 200 : 422);
    } catch (err) {
      return c.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 400);
    }
  });

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

      const session = await getOrCreateSession(body.sessionId || "alpha-treasury");
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
      const minRatioBps = parseUint64(body.minRatioBps, "minRatioBps");
      const maxSingleBps = parseUint64(body.maxSingleBps, "maxSingleBps");
      const session = await getOrCreateSession(body.sessionId || "alpha-treasury");
      const res = await session.tightenPolicy({ minRatioBps, maxSingleBps });
      return c.json(res, res.ok ? 200 : 422);
    } catch (err) {
      return c.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 400);
    }
  });

  return app;
}
