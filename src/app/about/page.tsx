import Link from "next/link";
import type {Metadata} from "next";
import {AgentWallet} from "@/components/agent-wallet";

export const metadata: Metadata = {
  title: "AERIS — Product & evidence",
  description: "What AERIS observes on Arc Mainnet, how its agent verifies evidence, and the path to Circle-powered economic actions.",
};

export default function AboutPage() {
  return <main className="buildPage">
    <header><Link href="/" className="brand">AERIS</Link><nav aria-label="Product pages"><Link href="/">Live</Link><Link href="/payments">Payments</Link><b aria-current="page">About</b></nav><span className="buildBadge">ARC MAINNET</span></header>
    <section className="buildIntro">
      <small>PRODUCT & EVIDENCE</small>
      <h1>Follow the money. Check the decision.</h1>
      <p>AERIS connects live Arc USDC activity with personal wallet transfers and independently checked receipts.</p>
      <div className="buildLinks"><Link href="/">Explore live activity ↗</Link><a href="https://github.com/huseyin07/-AERIS" target="_blank" rel="noopener noreferrer">Public source ↗</a><a href="https://x.com/AERIS_arc" target="_blank" rel="noopener noreferrer">Builder updates ↗</a></div>
    </section>
    <section className="buildCard reviewerPath">
      <h2>Review AERIS in three steps</h2>
      <ol><li><Link href="/">Inspect live activity</Link> — open Data Health, select a transfer and compare its Arc explorer evidence.</li><li><Link href="/payments">Prepare a personal transfer</Link> — connect your wallet, enter a recipient and amount, and review the USDC network fee.</li><li><Link href="/payments#settlement-evidence">Check settlement</Link> — after approving a transfer in your wallet, match its recipient, amount and confirmed receipt. Export the receipt for independent review.</li></ol>
      <p className="buildMuted">No wallet connection is required to observe the network. Public transfers use each visitor’s own wallet. Circle treasury tools are a separate operator workflow.</p>
    </section>
    <details className="buildCard paymentDetails"><summary><span>How the evidence works</span><small>Observation, analysis and verification</small></summary>
      <h2>Observe → Analyze → Verify</h2>
      <p>Arc is the source of the product’s economic evidence: native USDC transfer events, contract calls, deployments, and wallet/contract classification. The observation window follows chain time, rather than a simulated clock.</p>
      <dl className="buildFacts">
        <div><dt>Observe</dt><dd>Rolling 10-minute USDC window; coverage and stale-head diagnostics.</dd></div>
        <div><dt>Analyze</dt><dd>Deterministic signals, policy checks, proactive investigations and evidence strength.</dd></div>
        <div><dt>Verify</dt><dd>Transaction and block references, linked ledger selections, explorer evidence.</dd></div>
        <div><dt>Visualize</dt><dd>Responsive 2D/3D views. Flows ≥1,000 USDC are visualized; ingestion observes smaller transfers too.</dd></div>
      </dl>
    </details>
    <details className="buildCard paymentDetails"><summary><span>Circle wallet identity</span><small>Live verification on Arc</small></summary><AgentWallet/></details>
    <section className="buildCard">
      <h2>Real data, explicit limits</h2>
      <p>When RPC access is unavailable, AERIS reports unavailable or partial data. Empty activity is never replaced by mock transactions.</p>
    </section>
    <section className="buildCard">
      <h2>What is demonstrated</h2>
      <div className="buildTableWrap"><table><thead><tr><th>Capability</th><th>Current scope</th><th>Acceptance evidence</th></tr></thead><tbody>
        <tr><td>Arc intelligence</td><td>Implemented</td><td>Live RPC observation, ledger and evidence links; deployment health must be checked live.</td></tr>
        <tr><td>Personal USDC transfers</td><td>Browser wallets and wallet mobile browsers</td><td>User wallet approval, fresh balance/fee checks and exact Arc receipt verification. No hosted custody or automatic spending.</td></tr>
        <tr><td>History & pending requests</td><td>Arc recovery and portable notes</td><td>Validated backups, fresh receipts, bounded status polling and nonce-checked replacement/cancellation.</td></tr>
        <tr><td>Mobile QR / Circle email wallets</td><td>Implemented; configuration pending</td><td>Reown project setup and Circle App ID/email delivery required before these connections are available.</td></tr>
        <tr><td>Circle wallet observation</td><td>Configured; verified at runtime</td><td>Circle identity + current Arc block + native USDC balance.</td></tr>
        <tr><td>Circle invoice payments</td><td>Local runner implemented; live settlement demonstration pending</td><td>Recipient allowlist, durable budget reservations, local approval, Circle EVM signing and exact Arc receipt verification.</td></tr>
        <tr><td>Usage & pilots</td><td>To be measured</td><td>Real user feedback, investigation usage and pilot outcomes; no invented traction.</td></tr>
      </tbody></table></div>
    </section>
    <details className="buildCard paymentDetails"><summary><span>Technical scope & source</span><small>Execution, tests and limitations</small></summary>
      <p>USDC totals use verified transfer events only. Contract activity is a bounded sample from recent blocks, rather than a full historical index. Wallet identity does not prove a transfer’s intent; the agent distinguishes evidence from interpretation.</p>
      <p>Public treasury spending remains disabled. User-controlled Circle payments require each user’s own approval challenge. The invoice runner executes on the operator’s computer with privately entered Circle credentials and a persistent journal. Browser settings become authority only after the operator saves the policy locally. Operator execution and a confirmed live receipt are still required to demonstrate an actual payment.</p>
      <div className="buildLinks"><Link href="/payments/operator">Circle operator payments ↗</Link></div>
      <div className="buildLinks"><a href="https://github.com/huseyin07/-AERIS/actions" target="_blank" rel="noopener noreferrer">CI checks ↗</a><a href="https://github.com/huseyin07/-AERIS/tree/main/tests" target="_blank" rel="noopener noreferrer">Tests ↗</a></div>
    </details>
    <footer><b>AERIS</b><Link href="/">Return to dashboard ↗</Link></footer>
  </main>;
}
