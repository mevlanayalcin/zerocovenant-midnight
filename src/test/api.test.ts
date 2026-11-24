import { describe, expect, it } from "vitest";
import { createZeroCovenantApp } from "../server/app.js";

describe("ZeroCovenant HTTP API & Compact Runtime Integration", () => {
  const app = createZeroCovenantApp();

  it("exposes health and compiled Compact ZKIR/verifier metadata", async () => {
    const healthRes = await app.request("/health");
    expect(healthRes.status).toBe(200);
    const health = (await healthRes.json()) as { ok: boolean; compilerVersion: string; circuits: number };
    expect(health.ok).toBe(true);
    expect(health.compilerVersion).toBe("0.36.1");
    expect(health.circuits).toBeGreaterThanOrEqual(7);

    const artRes = await app.request("/api/v1/artifacts");
    expect(artRes.status).toBe(200);
    const art = (await artRes.json()) as {
      sourceCode: string;
      circuits: Array<{ name: string; verifierSha256: string | null; zkirLines: number }>;
    };
    expect(art.sourceCode).toContain("export circuit attestSolvency()");
    const attest = art.circuits.find((c) => c.name === "attestSolvency");
    expect(attest?.zkirLines).toBeGreaterThan(50);
    expect(attest?.verifierSha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("seeds Epoch 1 dual-ledger state and verifies a new diversified Epoch 2 attestation", async () => {
    const sessRes = await app.request("/api/v1/session?sessionId=vitest-suite-1");
    expect(sessRes.status).toBe(200);
    const sessJson = (await sessRes.json()) as {
      session: {
        publicLedger: { lastAttestedEpoch: string; lastSolvencyVerified: boolean; usedNullifiersCount: string };
      };
    };
    expect(sessJson.session.publicLedger.lastAttestedEpoch).toBe("1");
    expect(sessJson.session.publicLedger.lastSolvencyVerified).toBe(true);

    const attestRes = await app.request("/api/v1/attest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: "vitest-suite-1",
        custodianBalances: ["3500000", "3200000", "2800000", "2500000"],
        totalLiabilities: "8500000",
        autoFreshSalt: true
      })
    });
    expect(attestRes.status).toBe(200);
    const attestJson = (await attestRes.json()) as {
      ok: boolean;
      state: { publicLedger: { lastAttestedEpoch: string; usedNullifiersCount: string } };
    };
    expect(attestJson.ok).toBe(true);
    expect(attestJson.state.publicLedger.lastAttestedEpoch).toBe("2");
    expect(attestJson.state.publicLedger.usedNullifiersCount).toBe("2");
  });

  it("rejects concentration trap and rogue-key attacks via compiled Compact circuits", async () => {
    const trapRes = await app.request("/api/v1/attest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: "vitest-suite-2",
        custodianBalances: ["7500000", "1500000", "1500000", "1500000"],
        totalLiabilities: "8000000",
        autoFreshSalt: true
      })
    });
    expect(trapRes.status).toBe(422);
    const trapJson = (await trapRes.json()) as { ok: boolean; error: string };
    expect(trapJson.ok).toBe(false);
    expect(trapJson.error).toContain("concentration");

    const rogueRes = await app.request("/api/v1/attack/rogue-key", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: "vitest-suite-2" })
    });
    expect(rogueRes.status).toBe(200);
    const rogueJson = (await rogueRes.json()) as { ok: boolean; error: string };
    expect(rogueJson.ok).toBe(false);
    expect(rogueJson.error).toContain("Unauthorized desk secret");
  });

  it("grants and cryptographically verifies selective auditor disclosure packets", async () => {
    const grantRes = await app.request("/api/v1/disclosure/grant", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: "vitest-suite-3",
        auditorLabel: "deloitte-assurance-2026",
        targetEpoch: "1"
      })
    });
    expect(grantRes.status).toBe(200);

    const sessRes = await app.request("/api/v1/session?sessionId=vitest-suite-3");
    const { session } = (await sessRes.json()) as {
      session: {
        privateWitness: {
          custodianBalancesUsd: [string, string, string, string];
          totalLiabilitiesUsd: string;
          epochSaltHex: string;
        };
      };
    };

    const verifyRes = await app.request("/api/v1/disclosure/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: "vitest-suite-3",
        auditorLabel: "deloitte-assurance-2026",
        targetEpoch: "1",
        custodianBalances: session.privateWitness.custodianBalancesUsd,
        totalLiabilities: session.privateWitness.totalLiabilitiesUsd,
        epochSaltHex: session.privateWitness.epochSaltHex
      })
    });
    expect(verifyRes.status).toBe(200);
    const verifyJson = (await verifyRes.json()) as {
      verification: { verified: boolean; grantOnLedger: boolean; rootMatchesLatest: boolean };
    };
    expect(verifyJson.verification.verified).toBe(true);
    expect(verifyJson.verification.grantOnLedger).toBe(true);
    expect(verifyJson.verification.rootMatchesLatest).toBe(true);
  });
});
