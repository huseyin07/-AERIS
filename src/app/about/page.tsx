import Link from "next/link";
import type {Metadata} from "next";
import {AgentWallet} from "@/components/agent-wallet";

export const metadata: Metadata = {
  title: "AERIS — Product & evidence",
  description: "What AERIS observes on Arc Mainnet, how its agent verifies evidence, and the path to Circle-powered economic actions.",
};

export default function AboutPage() {
  return <main className="buildPage">
    <header><Link href="/" className="brand">AERIS</Link><Link href="/">Open live dashboard ↗</Link><span className="buildBadge">ARC MAINNET</span></header>
    <section className="buildIntro">
      <small>PRODUCT & EVIDENCE</small>
      <h1>Intelligence for the Arc economy.</h1>
      <p>AERIS turns verified USDC activity into an explorable network and evidence-backed investigations. Builders can inspect material flows, identify active contracts, and trace an agent’s conclusions back to transactions.</p>
      <div className="buildLinks"><Link href="/">Explore live activity ↗</Link><a href="https://github.com/huseyin07/-AERIS" target="_blank" rel="noopener noreferrer">Public source ↗</a><a href="https://x.com/AERIS_arc" target="_blank" rel="noopener noreferrer">Builder updates ↗</a></div>
    </section>
    <section className="buildCard">
      <h2>Observe → Analyze → Verify</h2>
      <p>Arc is the source of the product’s economic evidence: native USDC transfer events, contract calls, deployments, and wallet/contract classification. The observation window follows chain time, rather than a simulated clock.</p>
      <dl className="buildFacts">
        <div><dt>Observe</dt><dd>Rolling 10-minute USDC window; coverage and stale-head diagnostics.</dd></div>
        <div><dt>Analyze</dt><dd>Deterministic signals, policy checks, proactive investigations and evidence strength.</dd></div>
        <div><dt>Verify</dt><dd>Transaction and block references, linked ledger selections, explorer evidence.</dd></div>
        <div><dt>Visualize</dt><dd>Responsive 2D/3D views. Flows ≥1,000 USDC are visualized; ingestion observes smaller transfers too.</dd></div>
      </dl>
    </section>
    <AgentWallet/>
    <section className="buildCard">
      <h2>Try the product in three steps</h2>
      <ol><li>Open the dashboard and check Data Health for the network, chain head and scan coverage.</li><li>Select a flow or paste a full address / transaction hash. Compare the ledger entry with its explorer reference.</li><li>Open Insights and investigate a material signal. Inspect the evidence and the agent’s task progress.</li></ol>
      <p>When RPC access is unavailable, AERIS reports unavailable or partial data. Empty activity is never replaced by mock transactions.</p>
    </section>
    <section className="buildCard">
      <h2>What is shipped, what comes next</h2>
      <div className="buildTableWrap"><table><thead><tr><th>Capability</th><th>Current scope</th><th>Acceptance evidence</th></tr></thead><tbody>
        <tr><td>Arc intelligence</td><td>Implemented</td><td>Live RPC observation, ledger and evidence links; deployment health must be checked live.</td></tr>
        <tr><td>Circle wallet observation</td><td>Implemented; setup required</td><td>Circle identity + current Arc block + native USDC balance.</td></tr>
        <tr><td>Approved economic actions</td><td>Planned</td><td>Authenticated approval, persistent budgets and idempotency, Circle signing, confirmed receipt.</td></tr>
        <tr><td>Usage & pilots</td><td>To be measured</td><td>Real user feedback, investigation usage and pilot outcomes; no invented traction.</td></tr>
      </tbody></table></div>
    </section>
    <section className="buildCard">
      <h2>Technical scope</h2>
      <p>USDC totals use verified transfer events only. Contract activity is a bounded sample from recent blocks, rather than a full historical index. Wallet identity does not prove a transfer’s intent; the agent distinguishes evidence from interpretation.</p>
      <p>Economic execution remains disabled. The next phase adds operator-approved Circle actions, followed by onchain receipt verification. Browser policy settings are not authority to spend server funds.</p>
      <div className="buildLinks"><a href="https://github.com/huseyin07/-AERIS/actions" target="_blank" rel="noopener noreferrer">CI checks ↗</a><a href="https://github.com/huseyin07/-AERIS/tree/main/tests" target="_blank" rel="noopener noreferrer">Tests ↗</a></div>
    </section>
    <footer><b>AERIS</b><Link href="/">Return to dashboard ↗</Link></footer>
  </main>;
}
