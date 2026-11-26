#!/usr/bin/env node
/**
 * ZeroCovenant — Reproducible Midnight Preview (Ledger 9) On-Chain Deployment & Circuit Runner
 *
 * Prerequisites (install in an isolated deploy workspace or scripts/node_modules):
 *   npm i @midnightntwrk/ledger-v9 @midnight-ntwrk/wallet-sdk-hd @midnight-ntwrk/wallet-sdk-facade@5.0.1 \
 *         @midnight-ntwrk/wallet-sdk-abstractions @midnight-ntwrk/wallet-sdk-shielded \
 *         @midnight-ntwrk/wallet-sdk-dust-wallet @midnight-ntwrk/wallet-sdk-unshielded-wallet@4.0.1 \
 *         @midnight-ntwrk/compact-js @midnight-ntwrk/midnight-js-contracts@5.0.1 \
 *         @midnight-ntwrk/midnight-js-http-client-proof-provider \
 *         @midnight-ntwrk/midnight-js-indexer-public-data-provider \
 *         @midnight-ntwrk/midnight-js-level-private-state-provider \
 *         @midnight-ntwrk/midnight-js-node-zk-config-provider \
 *         @midnight-ntwrk/midnight-js-types rxjs ws
 *
 * Start the Midnight Ledger 9 proof server first:
 *   docker run -d --name midnight-proof-server -p 127.0.0.1:6300:6300 midnightntwrk/proof-server:9.0.2 -v
 *
 * Usage:
 *   MIDNIGHT_PREVIEW_SEED=<64-hex-chars> node scripts/deploy-preview.mjs
 *
 * Optional env vars:
 *   MIDNIGHT_PROOF_SERVER_URL      (default: http://127.0.0.1:6300)
 *   MIDNIGHT_INDEXER_HTTP_URL      (default: https://indexer.preview.midnight.network/api/v4/graphql)
 *   MIDNIGHT_INDEXER_WS_URL        (default: wss://indexer.preview.midnight.network/api/v4/graphql/ws)
 *   MIDNIGHT_NODE_RPC_URL          (default: https://rpc.preview.midnight.network)
 *   MIDNIGHT_PRIVATE_STATE_PASS    (default: randomly generated ephemeral password for LevelDB)
 *   MIDNIGHT_RUN_TIGHTEN           (set to "1" to also exercise tightenCovenantPolicy + Epoch #2 attestSolvency)
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { WebSocket } from "ws";
import * as Rx from "rxjs";
import * as ledger from "@midnightntwrk/ledger-v9";
import { WalletSeeds } from "@midnight-ntwrk/wallet-sdk-hd";
import { WalletFacade, WalletEntrySchema } from "@midnight-ntwrk/wallet-sdk-facade";
import { InMemoryTransactionHistoryStorage, WalletTransaction } from "@midnight-ntwrk/wallet-sdk-abstractions";
import { ShieldedWallet } from "@midnight-ntwrk/wallet-sdk-shielded";
import { DustWallet } from "@midnight-ntwrk/wallet-sdk-dust-wallet";
import { createKeystore, PublicKey, UnshieldedWallet } from "@midnight-ntwrk/wallet-sdk-unshielded-wallet";
import { CompiledContract } from "@midnight-ntwrk/compact-js";
import { deployContract } from "@midnight-ntwrk/midnight-js-contracts";
import { httpClientProofProvider } from "@midnight-ntwrk/midnight-js-http-client-proof-provider";
import { indexerPublicDataProvider } from "@midnight-ntwrk/midnight-js-indexer-public-data-provider";
import { levelPrivateStateProvider } from "@midnight-ntwrk/midnight-js-level-private-state-provider";
import { NodeZkConfigProvider } from "@midnight-ntwrk/midnight-js-node-zk-config-provider";
import { createLedger9MidnightProvider, createLedger9WalletProvider } from "@midnight-ntwrk/midnight-js-types";

globalThis.WebSocket = WebSocket;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

const NETWORK_ID = "preview";
const INDEXER_HTTP = process.env.MIDNIGHT_INDEXER_HTTP_URL || "https://indexer.preview.midnight.network/api/v4/graphql";
const INDEXER_WS = process.env.MIDNIGHT_INDEXER_WS_URL || "wss://indexer.preview.midnight.network/api/v4/graphql/ws";
const NODE_RPC = process.env.MIDNIGHT_NODE_RPC_URL || "https://rpc.preview.midnight.network";
const PROOF_SERVER = process.env.MIDNIGHT_PROOF_SERVER_URL || "http://127.0.0.1:6300";
const ZK_ASSETS_DIR = process.env.MIDNIGHT_ZK_ASSETS_DIR || path.join(REPO_ROOT, "contract/src/managed/zero_covenant");
const LEVELDB_DIR = process.env.MIDNIGHT_LEVELDB_DIR || path.join(REPO_ROOT, ".preview-leveldb");
const OUT_FILE = process.env.MIDNIGHT_DEPLOYMENT_OUT || path.join(REPO_ROOT, "contract/preview-deployment.json");

const contractModuleUrl = pathToFileURL(path.join(ZK_ASSETS_DIR, "contract/index.js")).href;
const { Contract: ZeroCovenantContract, pureCircuits } = await import(contractModuleUrl);

const seedHex = (process.env.MIDNIGHT_PREVIEW_SEED || "").trim().replace(/^0x/, "");
if (!/^[0-9a-fA-F]{64}$/.test(seedHex)) {
  const generated = crypto.randomBytes(32).toString("hex");
  const seeds = WalletSeeds.fromMasterSeed(Buffer.from(generated, "hex"));
  const ks = createKeystore({ kind: "schnorr", secret: seeds.unshielded }, NETWORK_ID);
  console.log("No MIDNIGHT_PREVIEW_SEED (64 hex chars) provided.");
  console.log("Generated fresh Midnight Preview address:", ks.getBech32Address().asString());
  console.log("Fund this address with tNight at https://faucet.preview.midnight.network/ then rerun with:");
  console.log("  MIDNIGHT_PREVIEW_SEED=<your-64-hex-seed> node scripts/deploy-preview.mjs");
  process.exit(1);
}

const masterSeed = Buffer.from(seedHex, "hex");
const seeds = WalletSeeds.fromMasterSeed(masterSeed);
const unshieldedKeystore = createKeystore({ kind: "schnorr", secret: seeds.unshielded }, NETWORK_ID);
const deployerAddress = unshieldedKeystore.getBech32Address().asString();

console.log("[1/6] Booting Midnight Preview WalletFacade for", deployerAddress);

const resolvedCfg = WalletFacade.resolveConfiguration({
  networkId: NETWORK_ID,
  indexerClientConnection: { indexerHttpUrl: INDEXER_HTTP, indexerWsUrl: INDEXER_WS },
  provingServerUrl: new URL(PROOF_SERVER),
  relayURL: new URL(NODE_RPC.replace(/^http/, "ws")),
  txHistoryStorage: new InMemoryTransactionHistoryStorage(WalletEntrySchema),
  costParameters: { additionalFeeOverhead: 300_000_000_000_000n, feeBlocksMargin: 5 }
});

const facade = await WalletFacade.init({
  configuration: resolvedCfg,
  shielded: (cfg) => ShieldedWallet(cfg).startWithSeed(seeds.shielded),
  unshielded: (cfg) => UnshieldedWallet(cfg).startWithPublicKey(PublicKey.fromKeyStore(unshieldedKeystore)),
  dust: (cfg) => DustWallet(cfg).startWithSeed(seeds.dust, ledger.LedgerParameters.initialParameters().dust)
});

await facade.start(seeds);

console.log("[2/6] Waiting for Preview wallet sync & DUST readiness...");
let state = await Rx.firstValueFrom(facade.state().pipe(Rx.filter((s) => s.isSynced)));
const signAsync = (payload) => unshieldedKeystore.signDataAsync(payload);

const dustBalance = state.dust.balance(new Date());
if (dustBalance === 0n) {
  console.log("  Registering unshielded Night UTXOs for DUST generation...");
  const nightUtxos = state.unshielded.availableCoins.filter((c) => !c.meta.registeredForDustGeneration);
  if (nightUtxos.length === 0) {
    throw new Error(`No tNight UTXOs found for ${deployerAddress}. Claim from https://faucet.preview.midnight.network/ first.`);
  }
  const regRecipe = await facade.registerNightUtxosForDustGeneration(nightUtxos, unshieldedKeystore.getPublicKey(), signAsync);
  const regTx = await facade.finalizeRecipe(regRecipe);
  await facade.submitTransaction(regTx);
  state = await Rx.firstValueFrom(facade.state().pipe(Rx.filter((s) => s.isSynced && s.dust.balance(new Date()) > 0n)));
}

console.log("[3/6] Wiring Ledger 9 ZK providers against", PROOF_SERVER);

let overrideEpochSalt = null;
const witnesses = {
  localDeskSecret: ({ privateState }) => [privateState, privateState.deskSecret],
  getCustodianBalances: ({ privateState }) => [privateState, [...privateState.custodianBalances]],
  getTotalLiabilities: ({ privateState }) => [privateState, privateState.totalLiabilities],
  getEpochSalt: ({ privateState }) => [privateState, overrideEpochSalt ?? privateState.epochSalt]
};

const compiledContract = CompiledContract.make("zero_covenant", ZeroCovenantContract).pipe(
  CompiledContract.withWitnesses(witnesses),
  CompiledContract.withCompiledFileAssets(ZK_ASSETS_DIR)
);

const zkConfigProvider = new NodeZkConfigProvider(ZK_ASSETS_DIR);
const proofProvider = httpClientProofProvider({ url: PROOF_SERVER, zkConfigProvider });
const publicDataProvider = indexerPublicDataProvider({
  queryURL: INDEXER_HTTP,
  subscriptionURL: INDEXER_WS,
  webSocket: WebSocket
});
const dbPassword = process.env.MIDNIGHT_PRIVATE_STATE_PASS || `Zc!${crypto.randomBytes(12).toString("hex")}A9#`;
const privateStateProvider = levelPrivateStateProvider({
  midnightDbName: LEVELDB_DIR,
  privateStateStoreName: "zc-private-states",
  signingKeyStoreName: "zc-signing-keys",
  accountId: unshieldedKeystore.getAddress(),
  privateStoragePasswordProvider: () => dbPassword
});

const extractBytes = (ser) => (ser instanceof Uint8Array ? ser : ser?.bytes ?? ser);

const walletProvider = createLedger9WalletProvider({
  getCoinPublicKey: () => state.shielded.coinPublicKey.toHexString(),
  getEncryptionPublicKey: () => state.shielded.encryptionPublicKey.toHexString(),
  async balanceTx(tx, ttl) {
    const ledgerUnbound = ledger.Transaction.deserialize("signature", "proof", "pre-binding", tx.serialize());
    const adopted = WalletTransaction.adopt("Unbound", ledgerUnbound, state.activeProtocolVersion);
    const recipe = await facade.balanceUnboundTransaction(adopted, {
      ttl: ttl ?? new Date(Date.now() + 30 * 60 * 1000)
    });
    const signed = await facade.signRecipe(recipe, signAsync);
    const finalized = await facade.finalizeRecipe(signed);
    return extractBytes(finalized.serialize());
  }
});

const midnightProvider = createLedger9MidnightProvider(async (tx) => {
  const ledgerFinal = ledger.Transaction.deserialize("signature", "proof", "binding", tx.serialize());
  const adopted = WalletTransaction.adopt("Finalized", ledgerFinal, state.activeProtocolVersion);
  return await facade.submitTransaction(adopted);
});

const providers = {
  privateStateProvider,
  publicDataProvider,
  zkConfigProvider,
  proofProvider,
  walletProvider,
  midnightProvider,
  config: { networkId: NETWORK_ID, ttlSeconds: 1800 }
};

async function lookupBlockTxHash(blockHeight, contractAddr) {
  const q = `{ block(offset: { height: ${blockHeight} }) { transactions { hash contractActions { address } } } }`;
  const r = await fetch(INDEXER_HTTP, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: q })
  });
  const j = await r.json();
  const tx = (j.data?.block?.transactions ?? []).find((t) =>
    (t.contractActions ?? []).some((a) => a.address === contractAddr)
  );
  return tx?.hash ?? "";
}

const deskSecret = Uint8Array.from(crypto.randomBytes(32));
const initialPrivateState = {
  deskSecret,
  custodianBalances: [3_200_000n, 3_100_000n, 2_900_000n, 2_800_000n],
  totalLiabilities: 8_000_000n,
  epochSalt: Uint8Array.from(crypto.randomBytes(32))
};

console.log("[4/6] Deploying ZeroCovenant Compact contract to Midnight Preview...");
const deployed = await deployContract(providers, {
  compiledContract,
  privateStateId: "zeroCovenantPreviewDesk",
  initialPrivateState,
  args: [12_000n, 4_000n]
});

const contractAddress = deployed.deployTxData.public.contractAddress;
const deployTxId = deployed.deployTxData.public.txId;
const deployBlockHeight = Number(deployed.deployTxData.public.blockHeight);
const deployTxHash = await lookupBlockTxHash(deployBlockHeight, contractAddress);
console.log("  Deployed:", { contractAddress, deployTxId, deployTxHash, deployBlockHeight });

console.log("[5/6] Executing on-chain ZK attestSolvency() Epoch #1...");
const attestTx = await deployed.callTx.attestSolvency();
const attestTxId = attestTx.public.txId;
const attestBlockHeight = Number(attestTx.public.blockHeight);
const attestTxHash = await lookupBlockTxHash(attestBlockHeight, contractAddress);
console.log("  Attested:", { attestTxId, attestTxHash, attestBlockHeight });

console.log("[6/6] Executing on-chain ZK grantAuditorDisclosure() Epoch #1...");
const auditorPk = Uint8Array.from(crypto.createHash("sha256").update("finra-institutional-audit-2026").digest());
const grantTx = await deployed.callTx.grantAuditorDisclosure(auditorPk, 1n);
const grantTxId = grantTx.public.txId;
const grantBlockHeight = Number(grantTx.public.blockHeight);
const grantTxHash = await lookupBlockTxHash(grantBlockHeight, contractAddress);
console.log("  Grant published:", { grantTxId, grantTxHash, grantBlockHeight });

let extra = {};
if (process.env.MIDNIGHT_RUN_TIGHTEN === "1") {
  console.log("[+] Executing on-chain ZK tightenCovenantPolicy(12500n, 3500n)...");
  const tightenTx = await deployed.callTx.tightenCovenantPolicy(12_500n, 3_500n);
  const tightenBlockHeight = Number(tightenTx.public.blockHeight);
  const tightenTxHash = await lookupBlockTxHash(tightenBlockHeight, contractAddress);
  overrideEpochSalt = Uint8Array.from(crypto.randomBytes(32));
  console.log("[+] Re-attesting Epoch #2 under tightened 125% / 35% covenant...");
  const attest2Tx = await deployed.callTx.attestSolvency();
  const attest2BlockHeight = Number(attest2Tx.public.blockHeight);
  const attest2TxHash = await lookupBlockTxHash(attest2BlockHeight, contractAddress);
  extra = {
    tightenTxId: tightenTx.public.txId,
    tightenTxHash,
    tightenBlockHeight,
    attest2TxId: attest2Tx.public.txId,
    attest2TxHash,
    attest2BlockHeight
  };
}

const entityCommitmentHex = "0x" + Buffer.from(pureCircuits.deriveEntityCommitment(deskSecret)).toString("hex");
const out = {
  network: "preview",
  rpcUrl: NODE_RPC,
  indexerUrl: INDEXER_HTTP,
  deployerAddress,
  contractAddress,
  entityCommitmentHex,
  deployTxId,
  deployTxHash,
  deployBlockHeight,
  attestTxId,
  attestTxHash,
  attestBlockHeight,
  grantTxId,
  grantTxHash,
  grantBlockHeight,
  ...extra,
  deployedAt: new Date().toISOString()
};
fs.writeFileSync(OUT_FILE, JSON.stringify(out, null, 2) + "\n");
console.log("Saved deployment record ->", OUT_FILE);

await publicDataProvider.dispose();
await facade.stop();
process.exit(0);
