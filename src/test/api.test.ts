import { describe, expect, it } from "vitest";
import { createZeroCovenantApp } from "../server/app.js";

interface InitResponse {
  ok: boolean;
  sessionId: string;
  sessionToken: string;
  initialClientSeed: {
    epoch: string;
    custodianBalancesUsd: [string, string, string, string];
    totalLiabilitiesUsd: string;
    epochSaltHex: string;
    defaultAuditorLabel: string;
  };
  session: {
    publicLedger: {
      lastAttestedEpoch: string;
      lastSolvencyVerified: boolean;
      usedNullifiersCount: string;
      epochRootsCount: string;
    };
  };
}

describe("ZeroCovenant HTTP API, Privacy Boundary & Compact Runtime Integration", () => {
  const app = createZeroCovenantApp();

  async function initDesk(): Promise<InitResponse> {
    const res = await app.request("/api/v1/session/init", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deskName: "Vitest Institutional Desk" })
    });
    expect(res.status).toBe(200);
    return (await res.json()) as InitResponse;
  }

  it("exposes health and compiled Compact ZKIR/verifier metadata without secret-tag witness", async () => {
    const healthRes = await app.request("/health");
    expect(healthRes.status).toBe(200);
    const health = (await healthRes.json()) as { ok: boolean; compilerVersion: string; circuits: number };
    expect(health.ok).toBe(true);
    expect(health.compilerVersion).toBe("0.36.1");
    expect(health.circuits).toBeGreaterThanOrEqual(8);

    const artRes = await app.request("/api/v1/artifacts");
    expect(artRes.status).toBe(200);
    const art = (await artRes.json()) as {
      sourceCode: string;
      circuits: Array<{ name: string; verifierSha256: string | null; zkirLines: number }>;
    };
    expect(art.sourceCode).toContain("export circuit attestSolvency()");
    expect(art.sourceCode).toContain("computeDisclosureTag");
    expect(art.sourceCode).not.toContain("getAuditorSecretTag");
    const attest = art.circuits.find((c) => c.name === "attestSolvency");
    expect(attest?.zkirLines).toBeGreaterThan(50);
    expect(attest?.verifierSha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("enforces zero private witness leakage on public GET /api/v1/session and authenticates mutations", async () => {
    const created = await initDesk();

    const pubRes = await app.request(`/api/v1/session?sessionId=${encodeURIComponent(created.sessionId)}`);
    expect(pubRes.status).toBe(200);
    const rawText = await pubRes.text();
    const parsed = JSON.parse(rawText) as { session: Record<string, unknown> };

    // ZERO private witness fields in public GET response
    expect(parsed.session.privateWitness).toBeUndefined();
    expect(rawText).not.toContain("3200000");
    expect(rawText).not.toContain("8000000");
    expect(rawText).not.toContain(created.initialClientSeed.epochSaltHex);
    expect(rawText).not.toContain("deskSecret");

    // Unauthenticated mutation attempts MUST be rejected with 401
    const unauthReset = await app.request("/api/v1/session/reset", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: created.sessionId })
    });
    expect(unauthReset.status).toBe(401);

    const unauthAttest = await app.request("/api/v1/attest", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Session-Token": "wrong-token" },
      body: JSON.stringify({
        sessionId: created.sessionId,
        custodianBalances: ["3500000", "3200000", "2800000", "2500000"],
        totalLiabilities: "8500000"
      })
    });
    expect(unauthAttest.status).toBe(401);
  });

  it("verifies diversified Epoch 2 attestation and rejects cross-epoch salt replay", async () => {
    const created = await initDesk();
    const fixedSalt = "0x" + "55".repeat(32);

    const attest2 = await app.request("/api/v1/attest", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Session-Token": created.sessionToken },
      body: JSON.stringify({
        sessionId: created.sessionId,
        custodianBalances: ["3500000", "3200000", "2800000", "2500000"],
        totalLiabilities: "8500000",
        autoFreshSalt: false,
        epochSaltHex: fixedSalt
      })
    });
    expect(attest2.status).toBe(200);
    const attest2Json = (await attest2.json()) as {
      ok: boolean;
      state: { publicLedger: { lastAttestedEpoch: string; usedNullifiersCount: string; epochRootsCount: string } };
    };
    expect(attest2Json.ok).toBe(true);
    expect(attest2Json.state.publicLedger.lastAttestedEpoch).toBe("2");
    expect(attest2Json.state.publicLedger.usedNullifiersCount).toBe("2");
    expect(attest2Json.state.publicLedger.epochRootsCount).toBe("2");

    // Reusing the SAME fixed salt on Epoch 3 MUST trigger Nullifier replay detected
    const replay3 = await app.request("/api/v1/attest", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Session-Token": created.sessionToken },
      body: JSON.stringify({
        sessionId: created.sessionId,
        custodianBalances: ["3500000", "3200000", "2800000", "2500000"],
        totalLiabilities: "8500000",
        autoFreshSalt: false,
        epochSaltHex: fixedSalt
      })
    });
    expect(replay3.status).toBe(422);
    const replayJson = (await replay3.json()) as { ok: boolean; error: string };
    expect(replayJson.ok).toBe(false);
    expect(replayJson.error).toContain("Nullifier replay detected");
  });

  it("rejects concentration trap, policy loosening, and rogue-key attacks via Compact circuits", async () => {
    const created = await initDesk();

    const trapRes = await app.request("/api/v1/attest", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Session-Token": created.sessionToken },
      body: JSON.stringify({
        sessionId: created.sessionId,
        custodianBalances: ["7500000", "1500000", "1500000", "1500000"],
        totalLiabilities: "8000000",
        autoFreshSalt: true
      })
    });
    expect(trapRes.status).toBe(422);
    const trapJson = (await trapRes.json()) as { ok: boolean; error: string };
    expect(trapJson.error).toContain("concentration");

    const loosenRes = await app.request("/api/v1/policy/tighten", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Session-Token": created.sessionToken },
      body: JSON.stringify({
        sessionId: created.sessionId,
        minRatioBps: "10000",
        maxSingleBps: "10000"
      })
    });
    expect(loosenRes.status).toBe(422);

    const rogueRes = await app.request("/api/v1/attack/rogue-key", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Session-Token": created.sessionToken },
      body: JSON.stringify({ sessionId: created.sessionId })
    });
    expect(rogueRes.status).toBe(200);
    const rogueJson = (await rogueRes.json()) as { ok: boolean; blocked: boolean; error: string };
    expect(rogueJson.ok).toBe(false);
    expect(rogueJson.blocked).toBe(true);
    expect(rogueJson.error).toContain("Unauthorized desk secret");
  });

  it("verifies historical Epoch 1 disclosure strictly against epochRoots and rejects tampered balances after Epoch 2", async () => {
    const created = await initDesk();

    // Advance ledger to Epoch 2 so Epoch 1 is now a HISTORICAL epoch
    const ep2 = await app.request("/api/v1/attest", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Session-Token": created.sessionToken },
      body: JSON.stringify({
        sessionId: created.sessionId,
        custodianBalances: ["4000000", "3500000", "3000000", "2500000"],
        totalLiabilities: "9000000",
        autoFreshSalt: true
      })
    });
    expect(ep2.status).toBe(200);

    // 1. Authentic historical Epoch 1 packet MUST verify cleanly (without X-Session-Token!)
    const validRes = await app.request("/api/v1/disclosure/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: created.sessionId,
        auditorLabel: created.initialClientSeed.defaultAuditorLabel,
        targetEpoch: "1",
        custodianBalances: created.initialClientSeed.custodianBalancesUsd,
        totalLiabilities: created.initialClientSeed.totalLiabilitiesUsd,
        epochSaltHex: created.initialClientSeed.epochSaltHex
      })
    });
    expect(validRes.status).toBe(200);
    const validJson = (await validRes.json()) as {
      verification: { verified: boolean; grantOnLedger: boolean; rootMatchesEpoch: boolean; tagMatchesLedger: boolean };
    };
    expect(validJson.verification.verified).toBe(true);
    expect(validJson.verification.grantOnLedger).toBe(true);
    expect(validJson.verification.rootMatchesEpoch).toBe(true);
    expect(validJson.verification.tagMatchesLedger).toBe(true);

    // 2. Tampered historical Epoch 1 packet ($999B fabricated reserves) MUST be rejected!
    const forgedRes = await app.request("/api/v1/disclosure/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: created.sessionId,
        auditorLabel: created.initialClientSeed.defaultAuditorLabel,
        targetEpoch: "1",
        custodianBalances: ["999000000000", "0", "0", "0"],
        totalLiabilities: "1",
        epochSaltHex: "0x" + "00".repeat(32)
      })
    });
    expect(forgedRes.status).toBe(200);
    const forgedJson = (await forgedRes.json()) as {
      verification: { verified: boolean; rootMatchesEpoch: boolean; tagMatchesLedger: boolean };
    };
    expect(forgedJson.verification.verified).toBe(false);
    expect(forgedJson.verification.rootMatchesEpoch).toBe(false);
    expect(forgedJson.verification.tagMatchesLedger).toBe(false);
  });
});
