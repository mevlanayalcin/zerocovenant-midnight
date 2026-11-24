# ZeroCovenant — Midnight Privacy Wave 3 Pitch Deck

---

## Slide 1: ZeroCovenant
**Institutional Zero-Knowledge Proof-of-Solvency, Concentration Risk Covenants & Selective Auditor Disclosure on Midnight**
- Live App: `https://zerocovenant.mevlanayalcin.com.tr`
- GitHub: `https://github.com/mevlanayalcin/zerocovenant-midnight`
- Stack: Compact v0.28.0 (`compactc 0.36.1`), Midnight Ledger 9 WASM Runtime (`0.21.0`), React 19 + Hono

---

## Slide 2: The Institutional Dilemma
- Funds, OTC desks, stablecoin issuers, and DeFi vaults face two incompatible mandates:
  1. **Publish verifiable Proof-of-Solvency** to satisfy LPs and regulators.
  2. **Hide proprietary counterparty allocations** across Fireblocks, Coinbase Prime, Anchorage, and Copper — because revealing custodian balances triggers predatory liquidation hunting and regulatory leakage.

---

## Slide 3: Why Naive Proof-of-Reserves Fails
- Traditional sum-only PoR (`sum(assets) >= liabilities`) misses **hidden counterparty concentration**:
  - A desk can prove `150%` aggregate solvency while holding **62.5%** of all collateral inside one distressed exchange or custodian.
- **ZeroCovenant** makes both conditions mandatory inside a single ZK circuit:
  1. Aggregate Reserve Coverage `>= covenantMinRatioBps` (e.g. `120%`)
  2. Per-Custodian Share `<= covenantMaxSingleBps` (e.g. `40%`) across all private venues simultaneously.

---

## Slide 4: Midnight Dual-Ledger Privacy Architecture
- **Private Witness Vault (Never On-Chain):**
  - `deskSecret` (`Bytes<32>`)
  - `custodianBalances` (`Vector<4, Uint<64>>`)
  - `totalLiabilities` (`Uint<64>`)
  - `epochSalt` (`Bytes<32>`)
- **Explicit `disclose(...)` Boundary -> Public Midnight Ledger:**
  - `entityCommitment`, `lastSolvencyRoot`, `lastSolvencyVerified`, `lastAttestedEpoch`
  - `covenantMinRatioBps`, `covenantMaxSingleBps`
  - `usedNullifiers: Set<Bytes<32>>` (anti-replay)
  - `auditorGrants: Map<Bytes<32>, Bytes<32>>` (selective disclosure)

---

## Slide 5: Smart Contract Circuits (`zero_covenant.compact`)
- Compiled with **`compactc 0.36.1` (Zero `--skip-zk`)**:
  - `attestSolvency()`: 119-line ZKIR, `45 MB` prover key, BLS12-381 verifier (`d6a304...`)
  - `grantAuditorDisclosure(auditorPk, targetEpoch)`: 55-line ZKIR (`bd1821...`)
  - `tightenCovenantPolicy(minRatioBps, maxSingleBps)`: 43-line ZKIR (`4dad7e...`)
  - 4 verified pure circuits: `deriveEntityCommitment`, `computeReserveRoot`, `computeNullifier`, `computeGrantKey`

---

## Slide 6: Selective Auditor Disclosure (No Global Leakage)
- Regulators (e.g., FINRA / SEC / Big-4 Assurance) shouldn't read every trading desk's live books publicly, AND public transparency shouldn't block audited verification.
- Desks call `grantAuditorDisclosure(auditorPk, targetEpoch)` to anchor an epoch-scoped disclosure tag on Midnight.
- The auditor receives one encrypted off-chain preimage for **only that epoch**, runs `computeReserveRoot` + `computeGrantKey`, and verifies exact match against Midnight's `lastSolvencyRoot` & `auditorGrants`.

---

## Slide 7: Cryptographic Defenses Tested & Verified
- **Undercollateralized Balance Sheet (`<120%`)**: Rejected with `"Solvency covenant ratio breached"`.
- **Single-Custodian Trap (`150%` solvent, `62.5%` venue exposure)**: Rejected with `"Custodian 0 concentration exceeds covenant cap"`.
- **Salt Replay Attack**: Rejected with `"Nullifier replay detected"` via `usedNullifiers` Set.
- **Unauthorized Rogue Desk Key**: Rejected with `"Unauthorized desk secret key"`; public state stays untouched.
- **Automated Suite:** `10 / 10` Vitest specs passing (6 Compact Ledger 9 + 4 HTTP/API).

---

## Slide 8: Live Product Walkthrough
1. **Dual-Ledger Studio**: Manipulate private balances across 4 custodians vs on-chain ledger diff in real time.
2. **Adversarial & Policy Console**: Tighten on-chain risk caps and fire rogue-key tests against Ledger 9 WASM.
3. **Auditor Verifier Workbench**: Issue and verify epoch-scoped audit grants end-to-end.
4. **Compact / ZKIR / Lace Bridge**: Inspect ZKIR opcodes, verifier SHA-256 digests, and connect Lace Wallet (`window.midnight.mnLace`).

---

## Slide 9: Go-To-Market & Midnight Fit
- **Target Buyers**: Crypto-native asset managers, ETF issuers, RWA vaults (including tokenized index desks), and stablecoin treasuries needing continuous attestation without leaking alpha.
- **Why Only Midnight**: Programmable dual-ledger witnesses + first-class `Set`/`Map` ledger ADTs + explicit `disclose(...)` static compiler guarantees eliminate accidental privacy leaks by construction.

---

## Slide 10: Roadmap Post-Wave 3
- **Milestone 1:** Preprod / Mainnet Midnight Contract deployment & Lace Wallet DApp Connector proof submission.
- **Milestone 2:** Multi-party threshold witness feeds (read-only MPC / custodian API enclave attestations).
- **Milestone 3:** Continuous automated epoch proofs via institutional treasuries (`Meridian` x `ZeroCovenant`).
