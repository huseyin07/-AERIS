# AERIS — Tameion submission draft

Updated 9 October 2026 (Türkiye). This is a draft, not a submitted application. The organizer's form was read on this date. Complete the owner-specific fields and upload the recorded demo before submitting.

## Entry positioning

**Project name:** AERIS — Evidence-first invoice payments on Arc

**Problem statement:** A small business paying vendors in USDC must decide which obligations are due, preserve operating cash, enforce spending authority, and prove whether each payment actually settled. A balance display or a transaction hash alone cannot answer those questions. Retrying a payment after a network interruption can also pay the same invoice twice. AERIS connects invoice decisions with verified Arc evidence and a recoverable Circle payment path.

**Project description:** AERIS combines a live Arc Mainnet intelligence dashboard with an invoice payment workbench. It observes native USDC transfers, exposes coverage and freshness, and provides stateful, evidence-linked investigations. The workbench compares due and upcoming invoices with a Circle-verified treasury balance, prioritizes the oldest due obligations, includes maximum gas and reserve in its liquidity estimate, and exports a decision record. An operator-owned Node.js runner applies an allowlist, per-payment and fee-inclusive daily limits, reserve and approval thresholds before Circle EVM signing. It checks the exact signed transaction, records recoverable bytes before broadcast, and reconciles canonical Arc receipts. Confirmed invoices cannot be paid again from the same persistent journal. Next.js, React, viem, Circle Developer-Controlled Wallets and Arc native USDC are used.

**Agency and limits:** Investigation and payment decisions are deterministic and policy based; there is no claim that a language model makes the financial decision. Optional local automation skips a per-payment prompt only within the operator's saved limits. The runner must be launched by the operator. There is no hosted continuous scheduler, multi-user wallet custody, deployed onchain budget contract, sanctions service, PDF/email ingestion or receivables collection. This is a focused invoice-payables prototype, not a complete autonomous AP/AR department.

**Circle integration:** A dedicated Circle EVM wallet is configured and verified against Arc chain 5042. The mainnet wallet was funded with 0.3 USDC on 8 October. Circle signing and Arc settlement reconciliation are implemented and covered by tests. The operator cancelled the live payment trial; no actual outgoing Circle payment has been demonstrated. Funding is not payment volume. Live balance may change and should be refreshed before recording or submitting.

**Traction answer — truthful draft:** AERIS is at the working prototype stage. No business onboarding count, user count, paying customer count or feedback totals have been substantiated for this submission. No live invoice settlement is verified, so demonstrated payment volume is 0 USDC. Funding of the developer wallet and synthetic test transfers are excluded. Add actual event-period users, feedback, followers/stars and business outcomes only after checking them.

**Continued project answer:** AERIS existed before this event as an Arc activity visualization and investigation project. During the event it gained a Circle wallet observer, browser-local wallet monitoring, invoice preparation, liquidity planning, a local Circle signing runner, durable recovery and independent receipt verification. Describe the actual start date, prior program participation and awards using the builder's records. Do not claim the entire existing dashboard was created during Tameion.

**Public source:** https://github.com/huseyin07/-AERIS

**Live product:** https://aeris-two-eosin.vercel.app/

**Public personal transfers:** https://aeris-two-eosin.vercel.app/payments

**Circle operator invoice flow:** https://aeris-two-eosin.vercel.app/payments/operator

**Circle email wallets:** https://aeris-two-eosin.vercel.app/payments/circle (implementation prepared; production configuration pending)

**Reviewer guide:** https://aeris-two-eosin.vercel.app/about

**Event comparison:** https://github.com/huseyin07/-AERIS/compare/bdb48f8366477a985fa84d8f69682d1c14c43552...main

Baseline: latest main-branch commit before 27 September 2026 UTC, committed 26 September at 15:49 UTC. This separates event-period progress from the earlier dashboard; keep the final head fixed when submitting.

**GitHub handle:** huseyin07

**X profile:** https://x.com/AERIS_arc

## Exact required form fields still owned by the builder

| Field | Status |
| --- | --- |
| Email | Builder must supply the application email |
| Discord handle | Builder must supply the registered handle |
| Telegram handle | Builder must supply the registered handle |
| Team member count and names | Confirm the actual team; do not infer a solo team |
| Prior Canteen participation and awards | Confirm from actual records |
| Event-only GitHub comparison link | Prepared above using the last main-branch commit before 27 September UTC; freeze the final head at submission |
| Traction | Confirm real users/business use and event-period feedback; unverified metrics stay unclaimed |
| Video demo URL | Upload the provided recording to Loom/YouTube/Vimeo and provide a publicly accessible link under three minutes |

Arc OSS and a feedback call are optional commitments; leave them unchecked unless the builder chooses them. Do not submit the form, send community messages or invent identity fields as part of preparation.

## Reviewer path

1. Open the live dashboard. Inspect Data Health before interpreting the network.
2. Open Circle operator tools and refresh the Circle treasury. Add an actual vendor invoice, or label any interface-only example clearly as an unpaid draft.
3. Inspect the liquidity plan: due date, reserve, gas allowance, approval threshold and a hold when the next invoice would exhaust cash.
4. Download the invoice, policy and decision evidence. The public workbench cannot spend funds.
5. Review the local runner and recovery tests. Run preview privately if credentials are available. Do not expose credentials in the video.
6. Show a matching confirmed receipt only if a real payment was authorized and executed. In the current draft, state explicitly that live settlement remains pending.

## Required demo storyboard — 2 minutes, no invented settlement

| Time | Actual screen | Message |
| --- | --- | --- |
| 0:00–0:15 | Live Arc dashboard | Business money needs evidence, decisions and a verifiable outcome |
| 0:15–0:35 | Ledger / data health | Chain 5042, chain-relative coverage, exact transaction evidence |
| 0:35–0:55 | Payments / Circle balance | Circle identity is verified; the wallet holds real mainnet USDC |
| 0:55–1:20 | Clearly labelled unpaid invoice and liquidity plan | Due invoices are prioritized; gas, reserve and approval limits constrain the plan |
| 1:20–1:40 | Second invoice held | A payment that exhausts liquidity is held with a reason |
| 1:40–1:55 | Runner download and evidence export | Circle signs locally; recovery preserves one invoice and one signed transaction |
| 1:55–2:00 | Product scope | Live payment trial pending; no claimed customers or settled volume |

## Submission readiness

Code can be released without a live payment trial, but the entry cannot honestly claim the complete financial workflow has been demonstrated. The official FAQ expects genuine business use and USDC payments on the Circle Agent Stack. The remaining live-payment and business-use evidence are material judging gaps, not documentation tasks. The recorded walkthrough demonstrates the shipped interface and these limits; it does not replace transaction evidence.

**Official deadline:** 17 October 2026, 23:59 US Eastern (18 October 2026, 06:59 Europe/Istanbul).

**Submission form:** https://forms.gle/BBWrdfuircrKiG2i6

**Official rules:** https://tameion.thecanteenapp.com/

## Public-wallet release update

The visitor transfer page now includes validated history import/export, chain-based cross-device recovery of direct outgoing transfers, bounded pending/confirming/unknown status polling and sender/nonce-checked replacement or cancellation reconciliation. Private notes travel in the backup; this is not automatic private-data cloud sync. Mobile WalletConnect QR and a separate user-controlled Circle email-wallet flow are implemented, but the deployed feature gates stay closed until the Reown Project ID and Circle App ID/production SMTP/abuse controls are configured. The mainnet developer-wallet observer and local signing runner remain distinct from user-controlled wallets.

The updated video is a captioned screen walkthrough of observed product capabilities and deployment limits, under three minutes. It does not depict a signed payment or a fabricated receipt. A verified outgoing Circle receipt, real business usage and builder-owned form fields still require genuine evidence before claiming a complete Tameion submission. The owner explicitly excluded live transfer testing. See `docs/public-wallet-setup.md` and `docs/pilot-evidence.md`.
