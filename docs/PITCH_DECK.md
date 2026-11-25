# ZeroCovenant — Midnight Privacy Wave 3 Pitch Deck

---

## Slide 1: ZeroCovenant
**Institutional Zero-Knowledge Proof-of-Solvency, Concentration Risk Covenants & Selective Auditor Disclosure on Midnight**
- Live App: `https://zerocovenant.mevlanayalcin.com.tr`
- Live Midnight Preview Contract (Ledger 9): `efc33d3c61ef7875f747d8a9442fa0c9e13086608f363c59d5f126ff37e24e25` (Deploy Block `#271364`, `attestSolvency()` Block `#271369`, `grantAuditorDisclosure()` Block `#271373`)
- GitHub: `https://github.com/mevlanayalcin/zerocovenant-midnight`
- Stack: Compact v0.28.0 (`compactc 0.36.1`), `midnightntwrk/proof-server:9.0.2`, Midnight Ledger 9, React 19 + Hono

---

## Slide 2: The Institutional Dilemma
- Funds, OTC desks, stablecoin issuers, and DeFi vaults face two incompatible mandates:
  1. **Publish verifiable Proof-of-Solvency** to satisfy LPs and regulators.
  2. **Hide proprietary counterparty allocations** across Fireblocks, Coinbase Prime, Anchorage, and Copper — because revealing custodian balances triggers predatory liquidation hunting and regulatory leakage.

---

## Slide 3: Why Naive Proof-of-Reserves Fails
- Traditional sum-only PoR (`sum(assets) >= liabilities`) misses **hidden counterparty concentration**:
  - A desk can prove `150%` aggregate solvency while holding **62.5%** of all collateral inside one distressed exchange or custodian.
- **ZeroCovenant** makes both conditions mandatory inside a single ZK circuit (with `liabilities > 0`):
  1. Aggregate Reserve Coverage `>= covenantMinRatioBps` (e.g. `120%`)
  2. Per-Custodian Share `<= covenantMaxSingleBps` (e.g. `40%`, bounded `25%..100%` for 4 custodians) across all private venues simultaneously.

---

## Slide 4: Midnight Dual-Ledger Privacy Architecture
- **Private Witness Vault (Browser-Local Vault & Ephemeral Prover Memory):**
  - `deskSecret` (`Bytes<32>` — per-session CSPRNG), `custodianBalances` (`Vector<4, Uint<64>>`), `totalLiabilities` (`Uint<64>`), `epochSalt` (`Bytes<32>`)
  - Scrubbed after every circuit call; `GET /api/v1/session` exposes **0 private witness fields**.
- **Explicit `disclose(...)` Boundary -> Public Midnight Ledger:**
  - `entityCommitment`, `lastSolvencyRoot`, `lastSolvencyVerified`, `lastAttestedEpoch`
  - `epochRoots: Map<Uint<64>, Bytes<32>>` (immutable historical commitment registry)
  - `covenantMinRatioBps`, `covenantMaxSingleBps` (monotonic tightening only)
  - `usedNullifiers: Set<Bytes<32>>` (cross-epoch salt replay prevention)
  - `auditorGrants: Map<Bytes<32>, Bytes<32>>` (one-way root-bound disclosure tags)

---

## Slide 5: Smart Contract Circuits (`zero_covenant.compact`)
- Compiled with **`compactc 0.36.1` (Zero `--skip-zk`)**:
  - `attestSolvency()`: 132-line ZKIR, BLS12-381 verifier (`afd59eec...`)
  - `grantAuditorDisclosure(auditorPk, targetEpoch)`: 68-line ZKIR (`0f5e7b44...`)
  - `tightenCovenantPolicy(minRatioBps, maxSingleBps)`: 61-line ZKIR (`d4b1f64d...`)
  - 5 verified pure circuits: `deriveEntityCommitment`, `computeReserveRoot`, `computeNullifier`, `computeGrantKey`, `computeDisclosureTag`

---

## Slide 6: Root-Bound Selective Auditor Disclosure (No Global Leakage)
- Regulators (FINRA / SEC / Big-4 Assurance) need auditable historical snapshots without forcing public exposure of live counterparty allocations.
- Desks call `grantAuditorDisclosure(auditorPk, targetEpoch)` to anchor a one-way `persistentHash(["zc:disclosure:v2", epochRoots[epoch], auditorPk, epoch])` tag on Midnight — **zero `deskSecret` material enters the tag**.
- The auditor receives the private off-chain preimage for **only that epoch**, runs `computeReserveRoot`, `computeGrantKey`, and `computeDisclosureTag`, and verifies exact match against on-chain `epochRoots[targetEpoch]` & `auditorGrants` — even for historical epochs after newer epochs are attested.

---

## Slide 7: Cryptographic Defenses Tested & Verified (`14 / 14` Specs)
- **Undercollateralized Balance Sheet (`<120%`)**: Rejected with `"Solvency covenant ratio breached"`.
- **Zero-Liability Vacuous Proof**: Rejected with `"Total liabilities must be strictly positive"`.
- **Single-Custodian Trap (`150%` solvent, `62.5%` venue exposure)**: Rejected with `"Custodian 0 concentration exceeds covenant cap"`.
- **Cross-Epoch Salt Replay Attack**: Rejected across epochs with `"Nullifier replay detected"` via `usedNullifiers`.
- **Covenant Loosening / Impossible `<25%` Cap**: Rejected inside `tightenCovenantPolicy()`; tightening resets `lastSolvencyVerified = false`.
- **Tampered Historical Epoch Verification**: Rejected (`verified: false`) against immutable `epochRoots[epoch]`.
- **Unauthorized Rogue Desk Key & Unauthenticated Mutations**: Rejected (`"Unauthorized desk secret key"` / HTTP `401`).

---

## Slide 8: Live Product Walkthrough
1. **Isolated Dual-Ledger Studio**: Per-visitor CSPRNG session, browser-local witness vault vs public Midnight Ledger 9 diff in real time.
2. **Monotonic Policy & Adversarial Console**: Tighten risk caps, verify loosening rejection, and fire rogue-key simulations against Ledger 9 WASM.
3. **Historical Auditor Verifier Workbench**: Issue grants, advance epochs, and verify or tamper-test any historical epoch end-to-end.
4. **Compact / ZKIR / Lace Bridge**: Inspect ZKIR opcodes, verifier SHA-256 digests, and detect Lace Wallet (`window.midnight.mnLace`).

---

## Slide 9: Go-To-Market & Midnight Fit
- **Target Buyers**: Crypto-native asset managers, ETF issuers, RWA vaults (including tokenized index desks), and stablecoin treasuries needing continuous attestation without leaking alpha.
- **Why Only Midnight**: Programmable dual-ledger witnesses + first-class `Set`/`Map` ledger ADTs + explicit `disclose(...)` static compiler guarantees eliminate accidental privacy leaks by construction.

---

## Slide 10: Live Midnight Preview Proofs & Roadmap Post-Wave 3
- **Completed in Wave 3:** Deployed `zero_covenant.compact` live on **Midnight Preview (Ledger 9)** with real ZK proofs via `midnightntwrk/proof-server:9.0.2` (`contractAddress: efc33d3c61ef7875f747d8a9442fa0c9e13086608f363c59d5f126ff37e24e25`, Deploy `#271364`, `attestSolvency()` `#271369`, `grantAuditorDisclosure()` `#271373`).
- **Milestone 2:** Multi-party threshold witness feeds (read-only MPC / custodian API enclave attestations).
- **Milestone 3:** Midnight Mainnet launch & continuous automated epoch proofs via institutional treasuries (`Meridian` x `ZeroCovenant`).
