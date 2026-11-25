# ZeroCovenant

[![License: Apache-2.0](https://img.shields.io/badge/License-Apache--2.0-indigo.svg)](./LICENSE)
[![Midnight Compact](https://img.shields.io/badge/Midnight%20Compact-v0.28.0%20%7C%20Ledger%209-blue.svg)](./contract/src/zero_covenant.compact)
[![Live Demo](https://img.shields.io/badge/Live%20Demo-https%3A%2F%2Fzerocovenant.mevlanayalcin.com.tr-emerald.svg)](https://zerocovenant.mevlanayalcin.com.tr)

**ZeroCovenant** is an institutional **Zero-Knowledge Proof-of-Solvency, Multi-Custodian Concentration Risk Covenant, and Selective Auditor Disclosure** protocol built with **Midnight Compact (`compactc 0.36.1`, Language `0.28.0`, Runtime `0.21.0`, Ledger 9)**.

> **Why naive Proof-of-Reserves fails institutions:** Publishing aggregate reserves (`sum(assets) >= liabilities`) either leaks sensitive counterparty balances on public blockchains or hides catastrophic single-venue concentration (e.g., 150% solvent on paper while 62.5% of assets sit on one failing custodian).
>
> **ZeroCovenant** enforces BOTH collateral adequacy AND per-custodian concentration caps (`<= covenantMaxSingleBps`) inside Zero-Knowledge circuits while leaking **0 private USD amounts, 0 custodian balances, 0 liabilities, 0 salts, and 0 desk keys** to the public Midnight ledger or HTTP GET APIs.

---

## Live Deployment, On-Chain Preview Proofs & Repository

- **Live HTTPS App & API:** [https://zerocovenant.mevlanayalcin.com.tr](https://zerocovenant.mevlanayalcin.com.tr)
- **Live On-Chain Verifier Endpoint:** [`GET /api/v1/preview/onchain`](https://zerocovenant.mevlanayalcin.com.tr/api/v1/preview/onchain) (queries `https://indexer.preview.midnight.network/api/v4/graphql` live)
- **GitHub Repository:** [https://github.com/mevlanayalcin/zerocovenant-midnight](https://github.com/mevlanayalcin/zerocovenant-midnight)
- **Health Endpoint:** [`GET /health`](https://zerocovenant.mevlanayalcin.com.tr/health)
- **OpenAPI 3.1 Spec:** [`GET /api/v1/openapi.json`](https://zerocovenant.mevlanayalcin.com.tr/api/v1/openapi.json)

### Verified Midnight Preview Testnet Deployment (Ledger 9 · `midnightntwrk/proof-server:9.0.2`)

| Artifact / On-Chain Proof | Value |
| :--- | :--- |
| **Network** | Midnight Preview (`https://rpc.preview.midnight.network` · Indexer v4 `https://indexer.preview.midnight.network/api/v4/graphql`) |
| **Contract Address** | `efc33d3c61ef7875f747d8a9442fa0c9e13086608f363c59d5f126ff37e24e25` |
| **Deploy ZK Tx (Block `#271364`)** | `00069370adc4a0e602e2b0b3178901d5bfbd78513d9b9b0bc8cbaa757e00790396` |
| **On-Chain ZK `attestSolvency()` Epoch #1 (Block `#271369`)** | `002d90eaffec912977287b85207c5c654c69cb95a9a02165144dbcb1bf88c132cf` |
| **On-Chain ZK `grantAuditorDisclosure()` Epoch #1 (Block `#271373`)** | `00399668528b841316b3f9d8a0fbd739f2985c3da2f1d8003448b8dac4e8a8ce1e` |
| **Entity Commitment** | `0x6f81df981a9369333dc83eb07e0600077cf0dac3dfe098029fee1911f8e2f877` |
| **Deployer Address** | `mn_addr_preview1srk6r6a6s8257rycfw670sz6qljdmckfeem72wfsxvncsc74f94syu46vh` |
| **Deployment Record** | [`contract/preview-deployment.json`](./contract/preview-deployment.json) |

---

## Dual-Ledger Privacy Model (`zero_covenant.compact`)

| Layer | Stored Data | Visibility |
| :--- | :--- | :--- |
| **Private Witness State (`ZeroCovenantPrivateState`)** | `deskSecret` (`Bytes<32>`), 4 custodian balances `b[0..3]` (`Vector<4, Uint<64>>`), `totalLiabilities` (`Uint<64>`), `epochSalt` (`Bytes<32>`) | **Browser-Local Vault / Ephemeral Prover Memory Only** — scrubbed after every circuit call and never exposed on `GET /api/v1/session` |
| **Public Midnight Ledger (`export ledger`)** | `epoch`, `attestationCount`, `entityCommitment`, `covenantMinRatioBps`, `covenantMaxSingleBps`, `lastSolvencyRoot`, `lastSolvencyVerified`, `lastAttestedEpoch`, `epochRoots: Map<Uint<64>, Bytes<32>>`, `usedNullifiers: Set<Bytes<32>>`, `auditorGrants: Map<Bytes<32>, Bytes<32>>` | **Public On-Chain State** — only cryptographic commitments, historical epoch roots, booleans, counters & explicit `disclose(...)` outputs |

### Compiled Compact Circuits (`compactc 0.36.1`, No `--skip-zk`)

All circuits in [`contract/src/zero_covenant.compact`](./contract/src/zero_covenant.compact) compile cleanly with full ZKIR & BLS12-381 prover/verifier keys:

1. **`attestSolvency(): Bytes<32>`** (132-line ZKIR · Verifier SHA-256 `afd59eec...`)
   - Authenticates caller witness `localDeskSecret()` against public `entityCommitment`.
   - Enforces `totalAssets > 0` AND `liabilities > 0` (preventing vacuous zero-liability proofs).
   - Verifies zero-knowledge reserve coverage inequality: `totalAssets * 10000 >= liabilities * covenantMinRatioBps`.
   - Verifies per-custodian concentration across all 4 private custodians: `b[i] * 10000 <= totalAssets * covenantMaxSingleBps`.
   - Derives cross-epoch anti-replay nullifier `computeNullifier(sk, salt)` (epoch-independent so reusing ANY salt across ANY epoch triggers `"Nullifier replay detected"`).
   - Anchors `root = computeReserveRoot(entityCommitment, curEpoch, b[0..3], liabilities, salt)` in BOTH `lastSolvencyRoot` and historical `epochRoots.insert(curEpoch, root)`.
2. **`grantAuditorDisclosure(auditorPk, targetEpoch): Bytes<32>`** (68-line ZKIR · Verifier SHA-256 `0f5e7b44...`)
   - Looks up `epochRoot = epochRoots.lookup(targetEpoch)` on-chain and computes one-way `computeDisclosureTag(epochRoot, auditorPk, targetEpoch)` with **zero `deskSecret` input** (eliminating secret-key recovery).
   - Inserts `(computeGrantKey(auditorPk, targetEpoch) -> tag)` into public `auditorGrants`.
3. **`tightenCovenantPolicy(newMinRatioBps, newMaxSingleBps)`** (61-line ZKIR · Verifier SHA-256 `d4b1f64d...`)
   - Enforces **monotonic tightening only** (`newMinRatioBps >= covenantMinRatioBps`, `2500 <= newMaxSingleBps <= covenantMaxSingleBps`) and resets `lastSolvencyVerified = false` until a fresh attestation proves compliance under the stricter covenant.
4. **Pure Verification Circuits:** `deriveEntityCommitment`, `computeReserveRoot`, `computeNullifier`, `computeGrantKey`, `computeDisclosureTag`.

---

## Walkthrough & Interactive Features

1. **Isolated Per-Visitor Sessions & Zero-Leakage Boundary**: Each browser session initializes via `POST /api/v1/session/init` with a CSPRNG 32-byte `deskSecret` and `X-Session-Token` auth. `GET /api/v1/session` returns strictly public ledger state (0 balances, 0 liabilities, 0 salts, 0 key bytes).
2. **Dual-Ledger Proof Studio**: Edit browser-local private custodian balances/liabilities, execute compiled ZK presets (**Healthy Diversified**, **Undercollateralized <120%**, **Concentration Trap >40%**, **Cross-Epoch Salt Replay**), and inspect SVG custodian concentration vs cap.
3. **Monotonic Covenant Governance & Adversarial Tests**: Tighten on-chain risk caps, test rejection of forbidden loosening (`100%/100%`) or impossible `<25%` caps, and run an authenticated **Rogue Key Attack Simulation** verified specifically against `"Unauthorized desk secret"`.
4. **Historical Selective Auditor Disclosure & Independent Verifier**: Issue epoch-scoped one-way disclosure grants, advance across multiple epochs, and verify ANY historical epoch against both on-chain `epochRoots[epoch]` and `auditorGrants` (tampered historical balances are rejected immediately).
5. **Compact Source, ZKIR & Lace Connector**: Inspect full `zero_covenant.compact`, real `.zkir` instruction counts & `.verifier` SHA-256 hashes, detect `window.midnight.mnLace`, and export Midnight artifact manifests.

---

## Local Development, Compact Compilation & Testing

### Prerequisites
- Node.js `>= 22`
- Midnight Compact compiler (`compactc` `0.36.1` for recompiling `.compact`; compiled JS/ZKIR/verifier outputs are included in [`contract/src/managed/zero_covenant`](./contract/src/managed/zero_covenant))

### Commands

```bash
npm install
npm run typecheck    # TypeScript strict check across contract + server + React client
npm test             # Executes 14 Vitest specs (9 Compact Ledger 9 + 5 HTTP/privacy API)
npm run build        # Production Vite bundle -> dist/client
npm run start        # Serves compiled SPA + Ledger 9 runtime API on http://127.0.0.1:8790
```

To recompile the Compact contract cleanly (with `compactc` on `PATH`):

```bash
npm run compact
```

---

## Execution Mode & Trust Model (Transparent Disclosure)

- **Live Midnight Preview Deployment + Interactive Ledger 9 Studio:** All 8 circuits in `contract/src/zero_covenant.compact` are compiled with official `compactc 0.36.1` (reproducible byte-for-byte with full ZKIR & BLS12-381 verifier keys, no `--skip-zk`), deployed live on **Midnight Preview** (`efc33d3c61ef7875f747d8a9442fa0c9e13086608f363c59d5f126ff37e24e25`, Block `#271364`), and exercised on-chain with real ZK proofs generated via `midnightntwrk/proof-server:9.0.2` (`attestSolvency()` Block `#271369` + `grantAuditorDisclosure()` Block `#271373`, verifiable live via `GET /api/v1/preview/onchain`). For sub-second interactive judging without requiring a local Proof Server or faucet wait, the web studio also runs the identical compiled Ledger 9 WASM contract per isolated session.
- **Privacy & Witness Boundary:** In the interactive web studio, browser-entered private witnesses are posted over TLS to the isolated per-session runtime (`X-Session-Token` authenticated), immediately scrubbed from memory after each circuit transition, and **never** returned on public `GET /api/v1/session` (even private rejection reasons are redacted from public history logs). On-chain deployments generate proofs locally via the institutional Midnight Proof Server (`http://127.0.0.1:6300`) so private balances never leave the enclave.
- **Custodian Balance Provenance:** The Wave 3 circuit verifies reserve coverage, concentration caps, nullifier uniqueness, and root-bound selective disclosure over desk-provided witnesses; cryptographic custodian attestations (MPC / TLSNotary / Fireblocks signed feeds) are slated for Milestone 2.

---

## Documentation

- [Pitch Deck](./docs/PITCH_DECK.md)
- [Akindo Midnight Wave 3 Submission Pack](./docs/SUBMISSION_WAVE3.md)
- [Compact Smart Contract](./contract/src/zero_covenant.compact)

## License

Licensed under the [Apache License 2.0](./LICENSE).
