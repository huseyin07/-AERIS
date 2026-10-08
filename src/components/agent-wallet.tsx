"use client";

import {useEffect, useState} from "react";
import type {AgentWalletStatus} from "@/circle/wallet-types";

export function AgentWallet() {
  const [wallet, setWallet] = useState<AgentWalletStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 25_000);
    let active = true;
    setLoading(true);
    setWallet(null);
    fetch("/api/agent-wallet", {cache: "no-store", signal: controller.signal})
      .then(async response => {
        if (response.status !== 200 && response.status !== 503) throw new Error("Wallet lookup failed");
        const value = await response.json() as AgentWalletStatus;
        if (active) setWallet(value);
      })
      .catch(() => {
        if (active) setWallet({status: "unavailable", network: "Arc Mainnet", chainId: 5042, execution: "disabled", message: "Wallet verification is temporarily unavailable."});
      })
      .finally(() => {window.clearTimeout(timeout); if (active) setLoading(false);});
    return () => {active = false; window.clearTimeout(timeout); controller.abort();};
  }, [revision]);

  return <section className="buildCard" id="agent-wallet" aria-labelledby="wallet-heading">
    <div className="buildCardHeading"><h2 id="wallet-heading">AERIS Agent Wallet</h2><span className="buildBadge">CIRCLE WALLETS</span></div>
    <p>Observe a developer-controlled wallet on Arc. Verify its identity with Circle and its USDC balance against the chain.</p>
    <div role="status" aria-live="polite">
      <strong>{loading ? "Verifying wallet…" : wallet?.status === "verified" ? "Wallet verified" : wallet?.status === "not-configured" ? "Setup pending" : "Verification unavailable"}</strong>
      {!loading && <p>{wallet?.message}</p>}
    </div>
    {!loading && wallet?.status === "verified" && <dl className="buildFacts">
      <div><dt>Network</dt><dd>Arc Mainnet · 5042</dd></div>
      <div><dt>USDC balance</dt><dd>{wallet.balanceUsdc} USDC</dd></div>
      <div><dt>Block</dt><dd>{wallet.blockNumber}</dd></div>
      <div><dt>Checked</dt><dd>{wallet.checkedAt ? new Date(wallet.checkedAt).toISOString() : "—"}</dd></div>
      <div><dt>Wallet</dt><dd><a href={wallet.explorerUrl} target="_blank" rel="noopener noreferrer">{wallet.address} ↗</a></dd></div>
    </dl>}
    <p className="buildMuted">The public server observes this wallet. Invoice payments are signed by Circle through the operator’s local runner.</p>
    <p><a href="/payments">Open invoice payments →</a></p>
    <button className="buildButton" disabled={loading} onClick={() => setRevision(value => value + 1)}>Refresh verification</button>
  </section>;
}
