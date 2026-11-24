# ZeroCovenant

[![License: Apache-2.0](https://img.shields.io/badge/License-Apache--2.0-indigo.svg)](./LICENSE)
[![Midnight Compact](https://img.shields.io/badge/Midnight%20Compact-v0.28.0%20%7C%20Ledger%209-blue.svg)](./contract/src/zero_covenant.compact)
[![Live Demo](https://img.shields.io/badge/Live%20Demo-https%3A%2F%2Fzerocovenant.mevlanayalcin.com.tr-emerald.svg)](https://zerocovenant.mevlanayalcin.com.tr)

**ZeroCovenant** is an institutional **Zero-Knowledge Proof-of-Solvency, Multi-Custodian Concentration Risk Covenant, and Selective Auditor Disclosure** protocol built with **Midnight Compact (`compactc 0.36.1`, Language `0.28.0`, Runtime `0.21.0`, Ledger 9)**.

> **Why naive Proof-of-Reserves fails institutions:** Publishing aggregate reserves (`sum(assets) >= liabilities`) either leaks sensitive counterparty balances on public blockchains or hides catastrophic single-venue concentration (e.g., 150% solvent on paper while 62.5% of assets sit on one failing custodian).
>
> **ZeroCovenant** enforces BOTH collateral adequacy AND per-custodian concentration caps (`<= covenantMaxSingleBps`) inside Zero-Knowledge circuits while leaking **0 private USD amounts, 0 custodian balances, 0 liabilities, and 0 desk keys** to the public Midnight ledger.

---

## Live Deployment & Repository

- **Live HTTPS App & API:** [https://zerocovenant.mevlanayalcin.com.tr](https://zerocovenant.mevlanayalcin.com.tr)
- **GitHub Repository:** [https://github.com/mevlanayalcin/zerocovenant-midnight](https://github.com/mevlanayalcin/zerocovenant-midnight)
- **Health Endpoint:** [`GET /health`](https://zerocovenant.mevlanayalcin.com.tr/health)
- **OpenAPI 3.1 Spec:** [`GET /api/v1/openapi.json`](https://zerocovenant.mevlanayalcin.com.tr/api/v1/openapi.json)

---

## Dual-Ledger Privacy Model (`zero_covenant.compact`)

| Layer | Stored Data | Visibility |
| :--- | :--- | :--- |
| **Private Witness State (`ZeroCovenantPrivateState`)** | `deskSecret` (`Bytes<32>`), 4 custodian balances `b[0..3]` (`Vector<4, Uint<64>>`), `totalLiabilities` (`Uint<64>`), `epochSalt` (`Bytes<32>`), per-auditor tag witness | **Local Prover Memory Only** — never leaves witness context |
| **Public Midnight Ledger (`export ledger`)** | `epoch`, `attestationCount`, `entityCommitment`, `covenantMinRatioBps`, `covenantMaxSingleBps`, `lastSolvencyRoot`, `lastSolvencyVerified`, `lastAttestedEpoch`, `usedNullifiers`, `auditorGrants` | **Public On-Chain State** — only cryptographic commitments, booleans, counters & explicit `disclose(...)` outputs |

### Compiled Compact Circuits (`compactc 0.36.1`)

All circuits in [`contract/src/zero_covenant.compact`](./contract/src/zero_covenant.compact) compile cleanly with full ZKIR & BLS12-381 prover/verifier keys (no `--skip-zk`):

1. **`attestSolvency(): Bytes<32>`** (119-line ZKIR)
   - Authenticates caller witness `localDeskSecret()` against public `entityCommitment`.
   - Verifies zero-knowledge reserve coverage inequality: `totalAssets * 10000 >= liabilities * covenantMinRatioBps`.
   - Verifies per-custodian concentration across all 4 private custodians: `b[i] * 10000 <= totalAssets * covenantMaxSingleBps`.
   - Derives epoch-bound nullifier (`computeNullifier(sk, curEpoch, salt)`) and rejects duplicates via `usedNullifiers`.
   - Discloses ONLY `lastSolvencyRoot = persistentHash(...)`, `lastSolvencyVerified = true`, `lastAttestedEpoch`, and increments counters.
2. **`grantAuditorDisclosure(auditorPk, targetEpoch): Bytes<32>`** (55-line ZKIR)
   - Inserts an epoch-scoped disclosure tag for a licensed auditor into public `auditorGrants` Map without revealing underlying balances to anyone else.
3. **`tightenCovenantPolicy(newMinRatioBps, newMaxSingleBps)`** (43-line ZKIR)
   - Updates on-chain minimum solvency and maximum venue concentration covenants under desk secret ownership control.
4. **Pure Verification Circuits:** `deriveEntityCommitment`, `computeReserveRoot`, `computeNullifier`, `computeGrantKey`.

---

## Walkthrough & Interactive Features

1. **Dual-Ledger Proof Studio**: Inspect live Side-by-Side Private Witness Vault vs Public Midnight Ledger 9 State, edit private custodian balances/liabilities, run real compiled ZK presets (**Healthy Diversified**, **Undercollateralized <120%**, **Hidden Concentration Trap >40%**, **Fixed-Salt Replay**), and inspect SVG custodian concentration vs cap.
2. **Covenant Policy & Adversarial Self-Tests**: Execute `tightenCovenantPolicy()` and run an adversarial **Rogue Key Attack Simulation** verifying Compact rejects unauthorized secret keys without mutating on-chain state.
3. **Selective Auditor Disclosure & Independent Verifier**: Grant an epoch-scoped disclosure entry to a specific regulator/auditor, then cryptographically verify an off-chain private audit packet against the public ledger root & grant map using compiled pure circuits.
4. **Compact Source, ZKIR & Lace Connector**: View full compiled `zero_covenant.compact`, real `.zkir` instruction counts & `.verifier` SHA-256 hashes, detect `window.midnight.mnLace`, and export Preprod deployment bundles.

---

## Local Development, Compact Compilation & Testing

### Prerequisites
- Node.js `>= 22`
- Midnight Compact compiler (`compactc` `0.36.1` for recompiling `.compact`; compiled JS/ZKIR/verifier outputs are included in [`contract/src/managed/zero_covenant`](./contract/src/managed/zero_covenant))

### Commands

```bash
npm install --registry=https://registry.npmjs.org
npm run typecheck    # TypeScript strict check across contract + server + React client
npm test             # Executes 10 Vitest specs across Compact Ledger 9 transitions + Hono HTTP API
npm run build        # Production Vite bundle -> dist/client
npm run start        # Serves compiled SPA + Ledger 9 runtime API on http://127.0.0.1:8790
```

To recompile the Compact contract cleanly:

```bash
compactc contract/src/zero_covenant.compact contract/src/managed/zero_covenant
```

---

## Documentation

- [Pitch Deck](./docs/PITCH_DECK.md)
- [Akindo Midnight Wave 3 Submission Pack](./docs/SUBMISSION_WAVE3.md)
- [Compact Smart Contract](./contract/src/zero_covenant.compact)

## License

Licensed under the [Apache License 2.0](./LICENSE).
