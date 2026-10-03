# AERIS grant preparation

## Programs and scope

Official criteria checked on 4 October 2026 (Europe/Istanbul):

- [Arc Microgrants](https://community.arc.io/public/events/arc-microgrants-f8tijfjhyq): working Arc Mainnet deployment, public repository, short description and public builder profile. Submissions close 14 October 2026, 23:59 ET (15 October, 06:59 in Istanbul). The current round offers twenty grants of 500 USDC. Prior Circle/Arc-funded work is ineligible. Do not represent eligibility as approved by the organizer.
- [Circle Developer Grants](https://www.circle.com/grant): meaningful Arc/Circle architecture, shipping evidence, usage or a credible path to it, and milestone-based ecosystem impact. No fixed deadline was stated on the reviewed page.

The first program rewards a working proof; the second supports a path to production. Disclose any awards in the other application. Keep scope and funding requests distinct, and obtain organizer clarification if either award changes eligibility. No application has been submitted by this change.

## Arc Microgrants application draft

**Project:** AERIS — Watch money move.

**Description:** AERIS is a real-time intelligence interface for Arc Mainnet. It reads native USDC transfers and bounded contract activity directly from Arc RPC, turns verified flows into an explorable 2D/3D network, and investigates material signals with transaction-linked evidence. A chain-relative rolling window, explicit data-health diagnostics and conservative classification keep live activity separate from unavailable or partial observations. The product needs no connected user wallet for exploration.

**Arc component:** Arc Mainnet is the sole economic data source (chain ID 5042). AERIS uses the native USDC ERC-20 interface, block headers, receipts and bytecode. It never substitutes testnet or simulated activity.

**Repository:** https://github.com/huseyin07/-AERIS

**Public profile:** https://x.com/AERIS_arc

**Live deployment:** Supply the verified production URL when submitting. The repository does not declare a canonical production hostname; do not invent one.

**Demo:** Open Data Health → select a USDC flow → compare ledger/explorer evidence → investigate a signal in Insights. Include a quiet-window or unavailable-state demonstration if RPC activity is sparse.

## Circle Developer Grants application draft

**Problem:** Raw onchain activity is difficult to interpret, and an agent's financial decision needs evidence, policy constraints and a verifiable outcome.

**Product:** AERIS provides the observation and investigation layer for Arc economic activity. Its next phase connects verified intelligence to operator-approved USDC actions through Circle Developer-Controlled Wallets, then verifies the resulting receipt on Arc.

**Integration status:** The Circle wallet read adapter is implemented. It authenticates server-side to Circle's wallet retrieval endpoint, verifies the configured developer-controlled EOA, checks Arc chain ID and head freshness, and reads native USDC balance at a specific block. Runtime verification still requires operator credentials and the correct wallet. Signing, transfers, persistent spending budgets and authenticated approvals are planned, not shipped. USDC observation is already implemented; Circle execution scaffolding remains disabled.

**Milestones and acceptance evidence:**

| Milestone | Deliverable | Evidence |
| --- | --- | --- |
| 1. Verify agent wallet | Configure a live Circle EOA and prove its Arc identity/balance | Successful `/api/agent-wallet` response with current block and explorer reference; no secrets in browser payloads |
| 2. Prepare and approve | Authenticated operator, allowlisted destination, exact USDC amount, durable daily budget, emergency stop and expiring approval bound to exact transaction | Tests for tampering, replay, concurrent budget reservation, policy violation and unauthorized requests |
| 3. Act and verify | Verified Circle signing adapter, persistent idempotency and submission ledger, Arc receipt reconciliation | Small operator-approved transfer with receipt, actual USDC transfer evidence and explorer URL; retries cannot duplicate spending |
| 4. Pilot and measure | Recruit real Arc builders; collect usage and product feedback | Real pilot count, completed investigations, feedback, RPC reliability and outcome measurements |

**Traction:** Usage, revenue and pilot counts have not been substantiated in this repository. Supply actual analytics and feedback before claiming them. CI and a shipped interface are technical evidence, not user traction.

**Grant amount and dates:** Set these with the builder after estimating integration, security and pilot work. Do not fabricate budget, partnerships or commitments.

## Release and submission gates

1. Review the PR, run tests/typecheck/lint/build, and verify the preview on desktop and mobile.
2. Verify the production deployment is Ready and `/api/activity` reports chain 5042 with current, covered observations. A successful compile is not proof of RPC availability.
3. Verify `/about` accurately distinguishes implemented, configured and planned features.
4. Configure Circle credentials privately in the deployment settings. Check `/api/agent-wallet` against Circle and Arc; missing credentials must say setup pending.
5. Record the exact live URL, reviewed commit and demo evidence in the application. Submit only after the builder reviews the final wording.

## Wallet setup

For read-only observation, set `CIRCLE_API_KEY`, `CIRCLE_EVM_WALLET_ID` (UUID) and `CIRCLE_EVM_WALLET_ADDRESS` on the server. Use a live developer-controlled EOA with an Arc-compatible `EVM` or `ARC` network identifier. Testnet wallets, mismatched addresses, frozen wallets and SCAs fail closed. Circle wallet identity and Arc balance are verified separately; Circle is not used as an Arc balance indexer.

The public endpoint intentionally publishes the configured agent's public address and balance after verification. Use a dedicated project wallet, not a personal treasury wallet. Requests are coalesced and cached in-process for 30 seconds on success; this is not a global rate limiter across serverless instances.

`CIRCLE_ENTITY_SECRET` is not needed for reads. `AERIS_CIRCLE_EXECUTION_ENABLED` cannot turn the unimplemented signing adapter into an executor. No route in this release sends or signs transactions.

Reference: [Circle wallet retrieval API](https://developers.circle.com/api-reference/w3s/developer-controlled-wallets/get-wallet).
