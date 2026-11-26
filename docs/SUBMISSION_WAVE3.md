# ZeroCovenant — Akindo Midnight Privacy Wave 3 Submission Pack

**Track:** Build Privacy-First Apps on Midnight (`jaMZjqPOBsLXvjdG`)
**License:** Apache-2.0 (`LICENSE`)
**Public GitHub Repo (tagged `midnightntwrk`):** `https://github.com/mevlanayalcin/zerocovenant-midnight`
**Live HTTPS Demo:** `https://zerocovenant.mevlanayalcin.com.tr`
**Live Midnight Preview Contract Address (Ledger 9):** `efc33d3c61ef7875f747d8a9442fa0c9e13086608f363c59d5f126ff37e24e25`
- **Deploy ZK Tx (Block `#271364`):** Hash `792e6cfe22ce48175478e64dfcd7500fa4a139fb9784c1b5c6739ee701dd1448` (ID `00069370adc4a0e602e2b0b3178901d5bfbd78513d9b9b0bc8cbaa757e00790396`)
- **On-Chain ZK `attestSolvency()` Ep #1 (Block `#271369`):** Hash `0492b71e9eae85d1b0e4d307980f7121ec445f00dfc8cf03b845d87469af9a63` (ID `002d90eaffec912977287b85207c5c654c69cb95a9a02165144dbcb1bf88c132cf`)
- **On-Chain ZK `grantAuditorDisclosure()` Ep #1 (Block `#271373`):** Hash `4492e8acf53ec2b54eea62f6154385aad7fd29f84dfa8fe6ee709687a368616a` (ID `00399668528b841316b3f9d8a0fbd739f2985c3da2f1d8003448b8dac4e8a8ce1e`)
- **On-Chain ZK `tightenCovenantPolicy(125%, 35%)` (Block `#275495`):** Hash `c261ff3ba90229fa3b977423652de539a6df08976ff84c3eb39e50c1ec8032ef` (ID `00262b90aa681b4110a63faa36d89d10a68eae1b3d4db3488d98459fb8b63b182e`)
- **On-Chain ZK `attestSolvency()` Ep #2 (Block `#275514`):** Hash `a53e4f06977bcd4bada5f21dc7dbd92852b16f2d41e24daaf440c934c2cfa497` (ID `004713d57cd41358b5758f451d27f5a997d5cbd433b36aa89489ef16fa23ac5039`)
- **Live Indexer v4 Verification API:** `https://zerocovenant.mevlanayalcin.com.tr/api/v1/preview/onchain`
- **Reproducible Deploy Script:** `scripts/deploy-preview.mjs`

---

## Project Title
**ZeroCovenant — Institutional ZK Proof-of-Solvency, Concentration Risk Covenants & Selective Auditor Disclosure on Midnight**

## Short Pitch (One-Liner)
Privacy-preserving Proof-of-Solvency and Multi-Custodian Concentration Covenant protocol built with Midnight Compact v0.28 / Ledger 9 — proving reserve coverage and diversification in Zero-Knowledge on Midnight Preview while keeping custodian balances, liabilities, salts, and desk keys off-chain, plus root-bound selective epoch disclosure for regulators.

## Description / Overview
Institutional crypto desks, RWA treasuries, and stablecoin issuers face a fundamental transparency paradox: traditional Proof-of-Reserves either leaks proprietary custodian balances publicly or checks only aggregate totals (`assets >= liabilities`), masking catastrophic single-venue concentration risks.

**ZeroCovenant** solves both problems on Midnight:
1. **Dual-Ledger Privacy Architecture (`contract/src/zero_covenant.compact`)**: All sensitive data (`deskSecret`, 4 custodian venue balances `b[0..3]`, `totalLiabilities`, `epochSalt`) is read via private witnesses. Only commitments (`entityCommitment`, `lastSolvencyRoot`, historical `epochRoots: Map<Uint<64>, Bytes<32>>`), monotonic covenant parameters, booleans, counters, cross-epoch anti-replay `usedNullifiers`, and one-way root-bound `auditorGrants` cross explicit `disclose(...)` boundaries to Midnight public state.
2. **Real Compact Compilation & Live Midnight Preview On-Chain Proofs (`compactc 0.36.1`, no `--skip-zk`)**: Produces real ZKIR circuits (`attestSolvency.zkir`, `grantAuditorDisclosure.zkir`, `tightenCovenantPolicy.zkir`) and BLS12-381 prover/verifier keys whose on-chain verifier keys on Midnight Preview (`efc33d3c...`) match the repository byte-for-byte. All 3 state-mutating circuits have been executed live on-chain via `scripts/deploy-preview.mjs` + `midnightntwrk/proof-server:9.0.2`.
3. **Transparent Off-Chain Interactive Studio (`https://zerocovenant.mevlanayalcin.com.tr`)**: Alongside live Preview Indexer v4 verification of the on-chain contract, the web studio runs an isolated per-visitor **off-chain compiled Compact simulator (no browser ZK proofs)** for instant interactive judging. Private inputs are POSTed over HTTPS (`X-Session-Token` authenticated) to `/api/v1/attest`, evaluated in ephemeral session memory, immediately scrubbed, and never returned on public `GET /api/v1/session` (even failed attestation attempts are omitted from public history). In production / CLI on-chain runs (`scripts/deploy-preview.mjs`), private witnesses remain strictly inside the operator's enclave alongside the local Midnight Proof Server.

## Team & Payout Details
- **Builder:** Mevlana Yalcin (Solo Engineer)
- **Discord:** `mevlana9682`
- **GitHub:** `https://github.com/mevlanayalcin`
- **Payout Address (EVM):** `0xFf135CeD375351ACBB2e8b6F32C96ccDB2a10161`
