# AERIS grant preparation

## Programs and scope

Official criteria checked on 8 October 2026 (Europe/Istanbul):

- [Arc Microgrants](https://community.arc.io/public/events/arc-microgrants-f8tijfjhyq): working Arc Mainnet deployment, public repository, short description and public builder profile. Submissions close 14 October 2026, 23:59 ET (15 October, 06:59 in Istanbul). The current round offers twenty grants of 500 USDC. Prior Circle/Arc-funded work is ineligible. Do not represent eligibility as approved by the organizer.
- [Circle Developer Grants](https://www.circle.com/grant): meaningful Arc/Circle architecture, shipping evidence, usage or a credible path to it, and milestone-based ecosystem impact. No fixed deadline was stated on the reviewed page.

The first program rewards a working proof; the second supports a path to production. Disclose any awards in the other application. Keep scope and funding requests distinct, and obtain organizer clarification if either award changes eligibility. No application has been submitted by this change.

## Arc Microgrants application draft

**Project:** AERIS — Watch money move.

**Description:** AERIS is a real-time intelligence interface for Arc Mainnet. It reads native USDC transfers and bounded contract activity directly from Arc RPC, turns verified flows into an explorable 2D/3D network, and investigates material signals with transaction-linked evidence. A chain-relative rolling window, explicit data-health diagnostics and conservative classification keep live activity separate from unavailable or partial observations. The product needs no connected user wallet for exploration.

**Arc component:** Arc Mainnet is the sole economic data source (chain ID 5042). AERIS uses the native USDC ERC-20 interface, block headers, receipts and bytecode. It never substitutes testnet or simulated activity.

**Repository:** https://github.com/huseyin07/-AERIS

**Public profile:** https://x.com/AERIS_arc

**Live deployment:** https://aeris-two-eosin.vercel.app/ (confirmed production alias in Vercel; rerun the release check immediately before submitting).

**Product evidence:** https://aeris-two-eosin.vercel.app/about (available in the grant preparation preview; requires the reviewed release to reach production).

**Demo:** Open Data Health → select a USDC flow → compare ledger/explorer evidence → investigate a signal in Insights. Include a quiet-window or unavailable-state demonstration if RPC activity is sparse.

## Circle Developer Grants application draft

**Problem:** Raw onchain activity is difficult to interpret, and an agent's financial decision needs evidence, policy constraints and a verifiable outcome.

**Product:** AERIS provides the observation and investigation layer for Arc economic activity. Its next phase connects verified intelligence to operator-approved USDC actions through Circle Developer-Controlled Wallets, then verifies the resulting receipt on Arc.

**Integration status:** Production Circle identity and Arc balance observation are configured. The invoice workbench and local Circle EVM signing/broadcast runner are implemented, with allowlists, operator approval thresholds, persistent fee-inclusive budget reservations and exact Arc receipt verification. The first funded live payment remains pending; do not equate passing synthetic tests with live settlement. Public server spending and the legacy browser spend scaffold remain disabled. See [Circle payments](circle-payments.md).

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
4. For Arc Microgrants, Circle configuration is not a release prerequisite. Report the actual runtime wallet status. Before claiming a live Circle Wallets integration, configure credentials privately and verify `/api/agent-wallet` against Circle and Arc.
5. Record the exact live URL, reviewed commit and demo evidence in the application. Submit only after the builder reviews the final wording.

## Repeatable deployment verification

Run `npm run verify:release -- https://aeris-two-eosin.vercel.app` against production, or supply the exact preview URL. The check verifies the dashboard, `/about`, current and covered Arc 5042 observations, and the wallet endpoint. A quiet but healthy window passes; stale or partial observations fail. Circle setup pending is explicitly reported without claiming live integration. Use `--require-circle` to require a verified Circle wallet and current balance evidence before presenting that integration.

On 6 October 2026, Vercel reported production commit `e10d56d898d04ef37b5f655bcba676d872845622` and grant preview commit `b44d00aa6f09d97e50134e77cf888e41b71b03f2` as READY. The preview wallet endpoint returned `not-configured`. Production activity returned chain 5042 and actual transfer records, but `partial` with `headStale: true` and approximately 55 minutes of chain-head lag. This is not proof of a current live observation. Recheck before submission; do not label the release ready based on deployment state alone.

A subsequent production check recovered to healthy, covered Arc observations at block `24563477`. Production still returned 404 for `/about` and `/api/agent-wallet` because PR #62 remains unmerged. The earlier stale observation was transient; record the latest check alongside submission evidence.

The grant preview passed dashboard, product evidence and current Arc observation checks at block `24563539`; its Circle endpoint explicitly reported setup pending. This passes the default read-only check but cannot pass `--require-circle` until configured.

## Wallet credentials

For read-only observation, set `CIRCLE_API_KEY`, `CIRCLE_EVM_WALLET_ID` (UUID) and `CIRCLE_EVM_WALLET_ADDRESS` on the server. Use a live developer-controlled EOA with an Arc-compatible `EVM` or `ARC` network identifier. Testnet wallets, mismatched addresses, frozen wallets and SCAs fail closed. Circle wallet identity and Arc balance are verified separately; Circle is not used as an Arc balance indexer.

The public endpoint intentionally publishes the configured agent's public address and balance after verification. Use a dedicated project wallet, not a personal treasury wallet. Requests are coalesced and cached in-process for 30 seconds on success; this is not a global rate limiter across serverless instances.

`CIRCLE_ENTITY_SECRET` is not needed for reads. Public server routes do not sign or send payments. The dedicated local runner uses the registered secret privately at execution time and enforces its own saved operator policy; the browser execution feature flag cannot authorize those funds.

Reference: [Circle wallet retrieval API](https://developers.circle.com/api-reference/w3s/developer-controlled-wallets/get-wallet).

## Tameion invoice workflow — 8 October 2026

The current target is also [Tameion Agents Hackathon](https://tameion.thecanteenapp.com/), with a complete invoice/payment workflow rather than a wallet balance card. The official page currently lists 17 October, 11:59 PM ET as the deadline. The workbench, local signing runner and recovery tests are implemented; a real funded Circle payment and verified Arc receipt are required before claiming the live execution milestone complete. Preview reads the existing public production wallet observer without copying the API secret into preview.
