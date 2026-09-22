"use client";

import dynamic from "next/dynamic";
import Image from "next/image";
import {useMemo, useState} from "react";
import {LiveActivity} from "./live-activity";
import {VisualizationBoundary} from "./visualization-boundary";
import {IntelligencePanel} from "./intelligence-panel";
import {useActivity} from "@/state/activity-store";
import {money, short} from "@/lib/format";
import {ARC} from "@/data/arc";
import type {Transfer} from "@/data/types";
import {buildIntelligenceSnapshot} from "@/intelligence/engine";

const NetworkScene = dynamic(
  () => import("@/visualization/network-scene").then(module => module.NetworkScene),
  {ssr: false, loading: () => <div className="sceneFallback">Loading observatory…</div>},
);

function finiteAmount(transfer: Transfer) {
  const amount = Number(transfer.value);
  return Number.isFinite(amount) && amount >= 0 ? amount : 0;
}

function UsdcIcon({className = ""}: {className?: string}) {
  return <Image className={`usdcIcon ${className}`} src="/usdc.svg" alt="" width={16} height={16}/>;
}

function transferType(transfer: Transfer) {
  if (transfer.toType === "contract") return "CONTRACT IN";
  if (transfer.fromType === "contract") return "CONTRACT OUT";
  return "TRANSFER";
}

export function Dashboard() {
  const transfers = useActivity(state => state.transfers);
  const status = useActivity(state => state.connection);
  const selected = useActivity(state => state.selected);
  const select = useActivity(state => state.select);
  const query = useActivity(state => state.query);
  const setQuery = useActivity(state => state.setQuery);
  const intent = useActivity(state => state.visualizationIntent);
  const setIntent = useActivity(state => state.setVisualizationIntent);
  const [agentOpen, setAgentOpen] = useState(false);
  const [agentRequest, setAgentRequest] = useState<{id: number; query: string} | null>(null);
  const snapshot = useMemo(() => buildIntelligenceSnapshot(transfers), [transfers]);

  const volume = snapshot.totalVolume;
  const addresses = snapshot.uniqueAddresses;
  const contracts = snapshot.activeContracts;
  const largest = transfers.find(transfer => transfer.id === snapshot.largestTransfer?.id);

  const normalizedQuery = query.trim().toLowerCase();
  const filtered = normalizedQuery ? transfers.filter(transfer =>
    transfer.txHash.toLowerCase().includes(normalizedQuery) ||
    transfer.from.toLowerCase().includes(normalizedQuery) ||
    transfer.to.toLowerCase().includes(normalizedQuery)) : transfers;

  const related = selected
    ? transfers.filter(transfer => transfer.from === selected || transfer.to === selected)
    : [];
  const sent = selected
    ? related.reduce((total, transfer) => total + (transfer.from === selected ? finiteAmount(transfer) : 0), 0)
    : 0;
  const received = selected
    ? related.reduce((total, transfer) => total + (transfer.to === selected ? finiteAmount(transfer) : 0), 0)
    : 0;
  const entityType = selected
    ? related.find(transfer => transfer.from === selected)?.fromType ?? related.find(transfer => transfer.to === selected)?.toType ?? "unknown"
    : "unknown";
  const emptyMessage = status === "unavailable" ? "Live data temporarily unavailable" : "Waiting for verified Arc Mainnet activity";
  const signal = snapshot.signals[0];
  const statusLabel = status === "live" ? "LIVE" : status === "stale" ? "STALE" : status === "unavailable" ? "UNAVAILABLE" : "CONNECTING";

  return <main>
    <LiveActivity/>
    <header>
      <div className="brand"><i/>AERIS</div>
      <nav><b>LIVE</b><span>EXPLORE</span><button onClick={() => setAgentOpen(true)}>INSIGHTS</button><span>REPLAY</span></nav>
      <input
        className="search"
        value={query}
        onChange={event => setQuery(event.target.value)}
        placeholder="Search address, transaction or entity"
        aria-label="Search address, transaction or entity"
      />
      <div className={`status ${status}`}><i/><span>ARC MAINNET · {statusLabel}</span></div>
    </header>

    <section className="observatory">
      <div className="scene" aria-label="Live Arc Mainnet entity network">
        <VisualizationBoundary>
          <NetworkScene transfers={transfers} selected={selected} intent={intent} onSelect={select}/>
        </VisualizationBoundary>
      </div>

      <section className="metrics" aria-label="Live metrics">
        <p className="eyebrow">LIVE ACTIVITY</p>
        <div className="assetHeading"><UsdcIcon/><span>ARC MAINNET USDC</span></div>
        <Metric icon label="USDC FLOW" value={`$${money(String(volume))}`}/>
        <Metric label="TRANSFERS" value={String(transfers.length)}/>
        <Metric label="ACTIVE ADDRESSES" value={String(addresses)}/>
        <Metric label="ACTIVE CONTRACTS" value={String(contracts)}/>
        <Metric icon label="LARGEST TRANSFER" value={largest ? `${money(largest.value)} USDC` : "—"}/>
      </section>

      <section className="entityPanel">
        {selected ? <>
          <button className="close" onClick={() => select(null)} aria-label="Close selected entity">×</button>
          <small>ENTITY</small>
          <h2>{short(selected)}</h2>
          <p className="address">{selected}</p>
          <dl>
            <div><dt>TYPE</dt><dd>{entityType.toUpperCase()}</dd></div>
            <div><dt>TRANSFERS</dt><dd>{related.length}</dd></div>
            <div><dt>USDC SENT</dt><dd className="coinValue"><UsdcIcon/>{money(String(sent))}</dd></div>
            <div><dt>USDC RECEIVED</dt><dd className="coinValue"><UsdcIcon/>{money(String(received))}</dd></div>
          </dl>
          <small className="recentLabel">RECENT FLOWS</small>
          <div className="recentEntityTransfers">
            {related.slice(-4).reverse().map(transfer => <a key={transfer.id} href={`${ARC.explorer}/tx/${transfer.txHash}`} target="_blank" rel="noreferrer">
              <span>{transfer.from === selected ? "SENT" : "RECEIVED"}</span><b className="coinValue"><UsdcIcon/>{money(transfer.value)}</b>
            </a>)}
          </div>
          <button className="askAddress" onClick={() => {setAgentRequest(current => ({id: (current?.id ?? 0) + 1, query: "Explain this address"})); setAgentOpen(true);}}>ASK AERIS ABOUT THIS ADDRESS</button><a className="explorerLink" href={`${ARC.explorer}/address/${selected}`} target="_blank" rel="noreferrer">VIEW ON ARC EXPLORER ↗</a>
        </> : <>
          <small>ARC MAINNET</small>
          <h2>Arc Mainnet</h2>
          <div className={`networkState ${status}`}><i/>{statusLabel}</div>
          <dl>
            <div><dt>CHAIN ID</dt><dd>5042</dd></div>
            <div><dt>ASSET</dt><dd className="coinValue"><UsdcIcon/>USDC</dd></div>
            <div><dt>BUFFER</dt><dd>{transfers.length} transfers</dd></div>
          </dl>
          <p className="panelNote">{status === "stale" ? "Using the last successfully verified observation window." : transfers.length ? "Displaying verified activity from the current live window." : emptyMessage}</p>
        </>}
        <IntelligencePanel snapshot={snapshot} transfers={transfers} selected={selected} connection={status} expanded={agentOpen} request={agentRequest} onExpand={() => setAgentOpen(true)} onClose={() => setAgentOpen(false)}/>
      </section>

      {!transfers.length && <div className="sceneEmpty"><span>{emptyMessage}</span><small>No simulated activity is shown</small></div>}

      <div className="legend">
        <span><i className="wallet"/>WALLET</span>
        <span><i className="contract"/>CONTRACT</span>
        <span><i className="unknown"/>UNKNOWN</span>
        <span><i className="flow"/>USDC FLOW</span>
      </div>
    </section>

    <section className="lowerBar">
      <div className="timeControls" aria-label="Activity time range">
        <button className="active">LIVE</button>
        {['1H', '24H', '7D', '30D'].map(label => <button key={label} disabled title="Historical indexing is not available yet">{label}</button>)}
        <small>HISTORICAL INDEXING NOT YET AVAILABLE</small>
      </div>
      <button className="signal" disabled={!signal} onClick={() => signal && setIntent({type: "highlight-transfers", transferIds: signal.relatedTransferIds})}><small>AERIS SIGNAL · {signal?.title ?? "OBSERVING"}</small><p>{signal?.description ?? (status === "stale" ? "Using the last successfully verified observation window." : "No verified activity is available in the current observation window.")}</p></button>
    </section>


    <section className="feed">
      <div className="feedHead"><div><small>LIVE LEDGER</small><h2>Recent verified transfers</h2></div><span>{ARC.name} · USDC · REAL-TIME</span></div>
      <div className="feedColumns"><span>FROM</span><span>TO</span><span>AMOUNT</span><span>TYPE</span><span>BLOCK</span></div>
      {filtered.slice().reverse().slice(0, 16).map(transfer => <a className="feedRow" key={transfer.id} href={`${ARC.explorer}/tx/${transfer.txHash}`} target="_blank" rel="noreferrer">
        <span className={`party ${transfer.fromType}`}><i/>{short(transfer.from)}</span><span className={`party ${transfer.toType}`}><i/>{short(transfer.to)}</span><b className="coinValue"><UsdcIcon/>{money(transfer.value)} <em>USDC</em></b><span>{transferType(transfer)}</span><small>{transfer.blockNumber}</small>
      </a>)}
      {!filtered.length && <p className="empty">{normalizedQuery ? "No matching verified transfers" : emptyMessage}</p>}
    </section>

    <footer><b>AERIS</b><span>Observe the network. Never invent the data.</span></footer>
  </main>;
}

function Metric({label, value, icon = false}: {label: string; value: string; icon?: boolean}) {
  return <div className="metric"><small>{icon && <UsdcIcon/>}{label}</small><strong>{value}</strong></div>;
}
