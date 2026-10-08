# AERIS submission copy

Prepared 8 October 2026. The Circle invoice feature was merged in PR #65 and deployed to production. No application has been submitted. For the current hackathon form, use [Tameion submission](tameion-submission.md); these grant drafts remain separate.

## Arc Microgrants

**Project name:** AERIS — Watch money move.

**Live product:** https://aeris-two-eosin.vercel.app/

**Public source:** https://github.com/huseyin07/-AERIS

**Builder profile:** https://github.com/huseyin07

**Project updates:** https://x.com/AERIS_arc

**Short description:** AERIS makes Arc Mainnet activity easier to inspect. It reads native USDC transfers directly from Arc RPC, presents an interactive 2D/3D network and transaction ledger, and investigates material signals with links to onchain evidence. Its rolling ten-minute window follows chain time, with explicit coverage and freshness diagnostics. Smaller transfers are included in observation; flows of at least 1,000 USDC are visualized. Users can explore without connecting a wallet.

**How it uses Arc:** Arc Mainnet, chain ID 5042, is AERIS's economic data source. The application reads native USDC transfer logs, block headers, transaction receipts and contract bytecode. It uses verified transaction and block references to support its conclusions. It does not replace unavailable observations with testnet or simulated transactions.

**Current scope:** Working observation, visualization and deterministic investigation. Agent memory and policy preferences are stored in the visitor's browser. Public server spending is disabled. Circle wallet observation and the local invoice payment runner are implemented. The treasury is funded; first live settlement is still pending.

**Funding request:** The program's 500 USDC microgrant supports continued development of the working Arc intelligence prototype. Do not add an unverified spending breakdown.

**Applicant facts still required:** Confirm the work has not already received Circle/Arc funding. Supply a receiving Arc wallet only in the organizer's appropriate payout flow. Do not invent applicant identity, team details or prior awards.

## Circle Developer Grants

**Problem:** Arc transactions are publicly observable, but raw logs alone do not explain the relationships between flows or provide an auditable basis for an agent's next action.

**Solution:** AERIS turns native USDC activity into a live network, an evidence-linked ledger and stateful investigations. Builders can inspect flows, compare counterparties and verify the underlying transactions. Classification and interpretation stay separate from what the chain proves.

**Circle and Arc integration:** Arc Mainnet and native USDC are used by the working observation layer. A server-side Circle Developer-Controlled Wallets observer has been implemented; live wallet identity and balance verification are configured. Circle EVM signing, local operator policy and Arc receipt reconciliation are implemented for invoices; live payment evidence still requires operator execution and receipt verification.

**Proposed next phase:** Demonstrate the implemented local Circle payment workflow with actual receipts, improve operator authentication and cross-device spending coordination, then pilot with real businesses. Run a builder pilot and report measured usage and feedback. Acceptance evidence for each stage is in [grants.md](grants.md).

**Traction:** No verified user, pilot, revenue or partnership metrics are available in the repository. Report actual figures supplied by the builder; otherwise state that the project is at the working prototype stage.

**Grant request:** Amount, milestone dates and team background require the builder's actual budget and availability. This application cannot be called complete until these fields are supplied. Do not claim a live Circle Wallets integration until `npm run verify:release -- <production-url> --require-circle` passes.

## Optional product demo — about two minutes

This walkthrough supports either grant application. Arc Microgrants does not list a recorded video as a requirement. Use the real product screen, not a mockup.

| Time | Screen/action | Narration |
| --- | --- | --- |
| 0:00–0:15 | Dashboard, compact heading | “AERIS helps builders inspect the Arc economy. It turns native USDC transfers into a network and investigations linked to real transactions.” |
| 0:15–0:35 | Open Arc Mainnet data health | “This is Arc Mainnet, chain 5042. Coverage and freshness are shown explicitly. The observation window follows the latest chain head.” |
| 0:35–1:00 | Select a material flow, inspect ledger and explorer link | “Selecting a flow connects the visualization to its sender, receiver, amount and transaction. The explorer link lets you verify the evidence.” |
| 1:00–1:30 | Open Insights, run a supported investigation | “The agent investigates the loaded observation, applies deterministic policy and records its evidence and browser-local memory. It does not infer a person's identity or claim to know a transfer's intent.” |
| 1:30–1:50 | Product & evidence page | “The product separates implemented capabilities from future work. Circle wallet observation is configured; invoice signing runs locally under operator policy. Its first real payment demonstration is pending.” |
| 1:50–2:00 | Return to dashboard | “The next phase connects verified intelligence to approved USDC actions and checks the resulting receipt on Arc.” |

If the window is quiet, show the healthy empty state. If the chain is stale or coverage partial, show that state honestly and postpone a live-readiness claim.

## Tameion is a separate target

The current official page lists 17 October 2026, 23:59 ET (18 October, 06:59 Istanbul), a public repository and a recorded demo under three minutes. Its focus is agents managing business money. AERIS has observation, investigation and an implemented local Circle invoice payment path. A live payment has not been demonstrated. Use [the current form draft and reviewer guide](tameion-submission.md), and do not claim a completed live treasury agent or unverified business traction.

Sources checked 8 October 2026: [Arc Microgrants](https://community.arc.io/public/events/arc-microgrants-f8tijfjhyq), [Circle Developer Grants](https://www.circle.com/grant), [Tameion](https://tameion.thecanteenapp.com/).
