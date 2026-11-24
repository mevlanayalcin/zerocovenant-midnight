import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export interface CircuitArtifactSummary {
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
}

export interface CompiledContractArtifacts {
  compilerVersion: string;
  languageVersion: string;
  runtimeVersion: string;
  ledgerVersion: string;
  sourceCode: string;
  sourceLines: number;
  circuits: CircuitArtifactSummary[];
}

function sha256Hex(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

function findRootDir(): string {
  const candidates = [process.cwd(), resolve(process.cwd(), ".."), "/app"];
  for (const dir of candidates) {
    if (existsSync(resolve(dir, "contract/src/zero_covenant.compact"))) {
      return dir;
    }
  }
  return process.cwd();
}

let cachedArtifacts: CompiledContractArtifacts | null = null;

export function loadCompiledArtifacts(): CompiledContractArtifacts {
  if (cachedArtifacts) return cachedArtifacts;

  const root = findRootDir();
  const managedDir = resolve(root, "contract/src/managed/zero_covenant");
  const sourcePath = resolve(root, "contract/src/zero_covenant.compact");
  const manifestPath = resolve(managedDir, "compiler/contract-manifest.json");
  const infoPath = resolve(managedDir, "compiler/contract-info.json");

  const sourceCode = existsSync(sourcePath) ? readFileSync(sourcePath, "utf8") : "";
  const manifest = existsSync(manifestPath)
    ? (JSON.parse(readFileSync(manifestPath, "utf8")) as Record<string, any>)
    : {};
  const info = existsSync(infoPath)
    ? (JSON.parse(readFileSync(infoPath, "utf8")) as { circuits?: Array<{ name: string; pure: boolean; proof: boolean }> })
    : { circuits: [] };

  const circuits: CircuitArtifactSummary[] = (info.circuits ?? []).map((c) => {
    const zkirPath = resolve(managedDir, "zkir", `${c.name}.zkir`);
    const verifierPath = resolve(managedDir, "keys", `${c.name}.verifier`);
    const proverManifestEntry = manifest.keys?.[`${c.name}.prover`] as { size?: number } | undefined;

    let zkirLines = 0;
    let zkirBytes = 0;
    const zkirOps: Record<string, number> = {};
    if (existsSync(zkirPath)) {
      const zkirText = readFileSync(zkirPath, "utf8");
      zkirLines = zkirText.split("\n").length;
      zkirBytes = Buffer.byteLength(zkirText, "utf8");
      try {
        const parsed = JSON.parse(zkirText) as { instructions?: Array<{ op?: string }> };
        for (const inst of parsed.instructions ?? []) {
          const op = inst.op ?? "unknown";
          zkirOps[op] = (zkirOps[op] ?? 0) + 1;
        }
      } catch {
        // Ignore malformed ZKIR
      }
    }

    let verifierBytes = 0;
    let verifierSha256: string | null = null;
    if (existsSync(verifierPath)) {
      const vBuf = readFileSync(verifierPath);
      verifierBytes = vBuf.length;
      verifierSha256 = sha256Hex(vBuf);
    }

    return {
      name: c.name,
      pure: c.pure,
      proof: c.proof,
      zkirFile: existsSync(zkirPath) ? `${c.name}.zkir` : null,
      zkirLines,
      zkirBytes,
      zkirOps,
      proverBytes: proverManifestEntry?.size ?? 0,
      verifierBytes,
      verifierSha256
    };
  });

  cachedArtifacts = {
    compilerVersion: String(manifest["compiler-version"] ?? "0.36.1"),
    languageVersion: String(manifest["language-version"] ?? "0.28.0"),
    runtimeVersion: String(manifest["runtime-version"] ?? "0.21.0"),
    ledgerVersion: "Midnight Ledger 9 (compact-runtime 0.21.0 / onchain-runtime-v4 4.0.2)",
    sourceCode,
    sourceLines: sourceCode ? sourceCode.split("\n").length : 0,
    circuits
  };

  return cachedArtifacts;
}
