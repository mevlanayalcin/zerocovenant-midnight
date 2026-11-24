# ZeroCovenant — Akindo Midnight Privacy Wave 3 Submission Pack

**Track:** Build Privacy-First Apps on Midnight (`jaMZjqPOBsLXvjdG`)
**License:** Apache-2.0 (`LICENSE`)
**Public GitHub Repo (tagged `midnightntwrk`):** `https://github.com/mevlanayalcin/zerocovenant-midnight`
**Live HTTPS Demo:** `https://zerocovenant.mevlanayalcin.com.tr`

---

## Project Title
**ZeroCovenant — Institutional ZK Proof-of-Solvency, Concentration Risk Covenants & Selective Auditor Disclosure on Midnight**

## Short Pitch (One-Liner)
Privacy-preserving Proof-of-Solvency and Multi-Custodian Concentration Covenant protocol built with Midnight Compact v0.28 / Ledger 9 — proving reserve coverage and diversification in Zero-Knowledge while keeping all custodian balances, liabilities, and desk keys completely off-chain, plus selective epoch-scoped disclosure for regulators.

## Description / Overview
Institutional crypto desks, RWA treasuries, and stablecoin issuers face a fundamental transparency paradox: traditional Proof-of-Reserves either leaks proprietary custodian balances publicly or checks only aggregate totals (`assets >= liabilities`), masking catastrophic single-venue concentration risks.

**ZeroCovenant** solves both problems on Midnight:
1. **Dual-Ledger Architecture (`contract/src/zero_covenant.compact`)**: All sensitive data (`deskSecret`, 4 custodian venue balances `b[0..3]`, `totalLiabilities`, `epochSalt`) resides exclusively in local `ZeroCovenantPrivateState` witnesses. Only commitments (`entityCommitment`, `lastSolvencyRoot`), covenant policy parameters, booleans, counters, anti-replay `usedNullifiers`, and keyed `auditorGrants` cross explicit `disclose(...)` boundaries to Midnight public state.
2. **Real Compact Compilation (`compactc 0.36.1`, no `--skip-zk`)**: Produces real ZKIR circuits (`attestSolvency.zkir` 119 lines, `grantAuditorDisclosure.zkir` 55 lines, `tightenCovenantPolicy.zkir` 43 lines), BLS12-381 prover/verifier keys, and TypeScript Ledger 9 bindings running natively on `@midnight-ntwrk/compact-runtime@0.21.0` & `@midnight-ntwrk/onchain-runtime-v4@4.0.2`.
3. **Interactive Adversarial & Verification Studio (`https://zerocovenant.mevlanayalcin.com.tr`)**: Judges can inspect private witness vs public ledger state side-by-side, trigger healthy attestations, observe Compact reject undercollateralized (`<120%`), single-custodian trap (`>40%` even at `150%` overall solvency!), replay nullifier, and rogue-key attacks, tighten on-chain risk covenants, and issue + independently verify selective auditor disclosures.

## Entry Question Answers (Verify Discord / Telegram IDs Before Final Submit!)
- **What is your Discord ID?** `<FILL_USER_DISCORD_ID>` (or check during final 1-click submit)
- **What is your Telegram ID?** `<FILL_USER_TELEGRAM_ID>` (or check during final 1-click submit)
- **Wallet / EVM / Midnight Payout Note:** Configured wallet on operator brief: `0xFf135CeD375351ACBB2e8b6F32C96ccDB2a10161`
