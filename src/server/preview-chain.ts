import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export interface PreviewDeploymentRecord {
  network: "preview";
  rpcUrl: string;
  indexerUrl: string;
  faucetTxId: string;
  deployerAddress: string;
  contractAddress: string;
  entityCommitmentHex: string;
  deployTxId: string;
  deployBlockHeight: number;
  attestTxId: string;
  attestBlockHeight: number;
  grantTxId: string;
  grantBlockHeight: number;
  deployedAt: string;
}

function findDeploymentFile(): string | null {
  const candidates = [
    resolve(process.cwd(), "contract/preview-deployment.json"),
    resolve(process.cwd(), "../contract/preview-deployment.json"),
    "/app/contract/preview-deployment.json"
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return null;
}

export function loadPreviewDeployment(): PreviewDeploymentRecord | null {
  const p = findDeploymentFile();
  if (!p) return null;
  try {
    return JSON.parse(readFileSync(p, "utf8")) as PreviewDeploymentRecord;
  } catch {
    return null;
  }
}

export async function queryLivePreviewContractState(): Promise<{
  deployed: boolean;
  deployment: PreviewDeploymentRecord | null;
  liveIndexer: {
    reachable: boolean;
    latestBlockHeight: number | null;
    contractActionType: string | null;
    stateBytesLength: number | null;
    chainTxHash: string | null;
    error?: string;
  };
}> {
  const deployment = loadPreviewDeployment();
  if (!deployment) {
    return {
      deployed: false,
      deployment: null,
      liveIndexer: {
        reachable: false,
        latestBlockHeight: null,
        contractActionType: null,
        stateBytesLength: null,
        chainTxHash: null,
        error: "No preview-deployment.json configured"
      }
    };
  }

  try {
    const query = `
      query CheckZeroCovenant($address: HexEncoded!) {
        block { height hash }
        contractAction(address: $address) {
          __typename
          address
          state
          transaction { hash }
        }
      }
    `;
    const resp = await fetch(deployment.indexerUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables: { address: deployment.contractAddress } }),
      signal: AbortSignal.timeout(8000)
    });
    const json = (await resp.json()) as {
      data?: {
        block?: { height?: number };
        contractAction?: {
          __typename?: string;
          address?: string;
          state?: string;
          transaction?: { hash?: string };
        } | null;
      };
      errors?: Array<{ message?: string }>;
    };

    const action = json.data?.contractAction ?? null;
    return {
      deployed: true,
      deployment,
      liveIndexer: {
        reachable: resp.ok && Boolean(json.data?.block),
        latestBlockHeight: json.data?.block?.height ?? null,
        contractActionType: action?.__typename ?? null,
        stateBytesLength: action?.state ? Math.floor(action.state.replace(/^0x/, "").length / 2) : null,
        chainTxHash: action?.transaction?.hash ?? null,
        ...(json.errors?.length ? { error: json.errors.map((e) => e.message).join("; ") } : {})
      }
    };
  } catch (err) {
    return {
      deployed: true,
      deployment,
      liveIndexer: {
        reachable: false,
        latestBlockHeight: null,
        contractActionType: null,
        stateBytesLength: null,
        chainTxHash: null,
        error: err instanceof Error ? err.message : String(err)
      }
    };
  }
}
