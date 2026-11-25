# ZeroCovenant — Akindo Midnight Privacy Wave 3 Submission Pack

**Track:** Build Privacy-First Apps on Midnight (`jaMZjqPOBsLXvjdG`)
**License:** Apache-2.0 (`LICENSE`)
**Public GitHub Repo (tagged `midnightntwrk`):** `https://github.com/mevlanayalcin/zerocovenant-midnight`
**Live HTTPS Demo:** `https://zerocovenant.mevlanayalcin.com.tr`
**Live Midnight Preview Contract Address (Ledger 9):** `efc33d3c61ef7875f747d8a9442fa0c9e13086608f363c59d5f126ff37e24e25`
- **Deploy ZK Tx (Block `#271364`):** `00069370adc4a0e602e2b0b3178901d5bfbd78513d9b9b0bc8cbaa757e00790396`
- **On-Chain ZK `attestSolvency()` Tx (Block `#271369`):** `002d90eaffec912977287b85207c5c654c69cb95a9a02165144dbcb1bf88c132cf`
- **On-Chain ZK `grantAuditorDisclosure()` Tx (Block `#271373`):** `00399668528b841316b3f9d8a0fbd739f2985c3da2f1d8003448b8dac4e8a8ce1e`
- **Live Indexer v4 Verification API:** `https://zerocovenant.mevlanayalcin.com.tr/api/v1/preview/onchain`

---

## Project Title
**ZeroCovenant — Institutional ZK Proof-of-Solvency, Concentration Risk Covenants & Selective Auditor Disclosure on Midnight**

## Short Pitch (One-Liner)
Privacy-preserving Proof-of-Solvency and Multi-Custodian Concentration Covenant protocol built with Midnight Compact v0.28 / Ledger 9 — proving reserve coverage and diversification in Zero-Knowledge while keeping all custodian balances, liabilities, salts, and desk keys completely off-chain, plus root-bound selective epoch disclosure for regulators.

## Description / Overview
Institutional crypto desks, RWA treasuries, and stablecoin issuers face a fundamental transparency paradox: traditional Proof-of-Reserves either leaks proprietary custodian balances publicly or checks only aggregate totals (`assets >= liabilities`), masking catastrophic single-venue concentration risks.

**ZeroCovenant** solves both problems on Midnight:
1. **Dual-Ledger Privacy Architecture (`contract/src/zero_covenant.compact`)**: All sensitive data (`deskSecret`, 4 custodian venue balances `b[0..3]`, `totalLiabilities`, `epochSalt`) resides exclusively inside local `ZeroCovenantPrivateState` witnesses. Only commitments (`entityCommitment`, `lastSolvencyRoot`, historical `epochRoots: Map<Uint<64>, Bytes<32>>`), monotonic covenant parameters, booleans, counters, cross-epoch anti-replay `usedNullifiers`, and one-way root-bound `auditorGrants` cross explicit `disclose(...)` boundaries to Midnight public state.
2. **Real Compact Compilation (`compactc 0.36.1`, no `--skip-zk`)**: Produces real ZKIR circuits (`attestSolvency.zkir`, `grantAuditorDisclosure.zkir`, `tightenCovenantPolicy.zkir`), BLS12-381 prover/verifier keys, and TypeScript Ledger 9 bindings running natively on `@midnight-ntwrk/compact-runtime@0.21.0` & `@midnight-ntwrk/onchain-runtime-v4@4.0.2`.
3. **Zero-Leakage Isolated Studio (`https://zerocovenant.mevlanayalcin.com.tr`)**: Each visitor runs an isolated session with a CSPRNG `deskSecret` and `X-Session-Token` auth. `GET /api/v1/session` exposes **0 private witness fields** (transient prover witnesses are scrubbed after every circuit call; private balance sheets stay exclusively in the browser's local vault). Judges can trigger healthy attestations, observe Compact reject undercollateralized (`<120%`), zero-liability, single-custodian trap (`>40%` even at `150%` solvency), cross-epoch fixed-salt nullifier replay, covenant loosening, impossible `<25%` caps, and rogue-key attacks, and independently verify historical epochs against on-chain `epochRoots` & `auditorGrants`.

## Team & Payout Details
- **Builder:** Mevlana Yalcin (Solo Engineer)
- **Discord:** `mevlana9682`
- **GitHub:** `https://github.com/mevlanayalcin`
- **Payout Address (EVM):** `0xFf135CeD375351ACBB2e8b6F32C96ccDB2a10161`
