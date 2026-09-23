"use client";

import dynamic from "next/dynamic";
import Image from "next/image";
import {useEffect, useMemo, useState} from "react";
import {LiveActivity} from "./live-activity";
import {VisualizationBoundary} from "./visualization-boundary";
import {IntelligencePanel} from "./intelligence-panel";
import {useActivity} from "@/state/activity-store";
import {money, short} from "@/lib/format";
import {ARC} from "@/data/arc";
import type {Transfer} from "@/data/types";
import {buildIntelligenceSnapshot, getEntityIntelligence} from "@/intelligence/engine";
import {selectSignificantTransfers, shortTransactionHash, transferIdentity, VISUAL_CAPS} from "@/visualization/network-model";

const NetworkScene = dynamic(
  () => import("@/visualization/network-scene").then(module => module.NetworkScene),
  {ssr: false, loading: () => <div className="sceneFallback">Loading observatory…</div>},
);

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
  const events = useActivity(state => state.events);
  const status = useActivity(state => state.connection);
  const selected = useActivity(state => state.selected);
  const select = useActivity(state => state.select);
  const query = useActivity(state => state.query);
  const setQuery = useActivity(state => state.setQuery);
  const intent = useActivity(state => state.visualizationIntent);
  const setIntent = useActivity(state => state.setVisualizationIntent);
  const [agentOpen, setAgentOpen] = useState(false);
  const [agentRequest, setAgentRequest] = useState<{id: number; query: string} | null>(null);
  const [selectedTransferId, setSelectedTransferId] = useState<string | null>(null);
  const [hoveredTransferId, setHoveredTransferId] = useState<string | null>(null);
  const [signalIndex, setSignalIndex] = useState(0);
  const snapshot = useMemo(() => buildIntelligenceSnapshot(transfers, Date.now(), events), [transfers, events]);
  const visualizationCandidates = useMemo(() => selectSignificantTransfers(transfers, 500), [transfers]);

  const volume = snapshot.totalVolume;
  const addresses = snapshot.uniqueAddresses;
  const contracts = snapshot.activeContracts;
  const largest = transfers.find(transfer => transfer.id === snapshot.largestTransfer?.id);

  const normalizedQuery = query.trim().toLowerCase();
  const filtered = normalizedQuery ? transfers.filter(transfer =>
    transfer.txHash.toLowerCase().includes(normalizedQuery) ||
    transfer.from.toLowerCase().includes(normalizedQuery) ||
    transfer.to.toLowerCase().includes(normalizedQuery)) : transfers;
  const activeTransferId = hoveredTransferId ?? selectedTransferId;
  const selectedTransfer = transfers.find(transfer => transferIdentity(transfer) === selectedTransferId) ?? null;

  useEffect(() => {
    if (!normalizedQuery) return;
    const match = transfers.find(transfer => transfer.txHash.toLowerCase() === normalizedQuery || transferIdentity(transfer) === normalizedQuery);
    if (match) { setSelectedTransferId(transferIdentity(match)); return; }
    const addressMatch = transfers.find(transfer => transfer.from.toLowerCase() === normalizedQuery || transfer.to.toLowerCase() === normalizedQuery);
    if (addressMatch) select(addressMatch.from.toLowerCase() === normalizedQuery ? addressMatch.from : addressMatch.to);
  }, [normalizedQuery, transfers, select]);

  const related = selected
    ? transfers.filter(transfer => transfer.from === selected || transfer.to === selected)
    : [];
  const entity = selected ? getEntityIntelligence(snapshot, selected) : null;
  const emptyMessage = status === "unavailable" ? "Live data temporarily unavailable" : "Waiting for verified Arc Mainnet activity";
  const signal = snapshot.signals[signalIndex % Math.max(1, snapshot.signals.length)];
  const statusLabel = status === "live" ? "LIVE" : status === "stale" ? "STALE" : status === "unavailable" ? "UNAVAILABLE" : "CONNECTING";
  const annotations = [...new Map([
    ...(selected ? [{address: selected, label: "SELECTED ENTITY"}] : []),
    ...(intent.type === "highlight-addresses" ? intent.addresses.map(address => ({address, label: "AERIS FOCUS"})) : []),
    ...(signal?.relatedAddresses.slice(0, 1).map(address => ({address, label: signal.title})) ?? []),
    ...(snapshot.entities.length >= 3 && snapshot.mostActiveByCount[0]?.transferCount > 1 ? [{address: snapshot.mostActiveByCount[0].address, label: snapshot.mostActiveByCount[0].type === "contract" ? "CONTRACT HUB" : "HIGH ACTIVITY"}] : []),
  ].map(item => [item.address.toLowerCase(), item])).values()];

  return <main>
    <LiveActivity/>
    <header>
      <div className="brand"><Image className="brandMark" src="/aeris-logo.svg" alt="" width={18} height={18}/>AERIS</div>
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
          <NetworkScene transfers={visualizationCandidates} annotations={annotations} selectedAddress={selected} selectedTransferId={activeTransferId} intent={intent} onSelectAddress={address => {select(address); setSelectedTransferId(null);}} onSelectTransfer={setSelectedTransferId}/>
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
          <small>ADDRESS · {entity?.type.toUpperCase() ?? "UNKNOWN"}</small>
          <h2>{short(selected)}</h2>
          <p className="address">{selected}</p>
          <small className="recentLabel">OBSERVED ACTIVITY</small>
          <dl className="entityIntelligence">
            <div onMouseEnter={() => setIntent({type: "highlight-transfers", transferIds: related.filter(item => item.from === selected).map(item => item.id)})} onMouseLeave={() => setIntent({type: "reset"})}><dt>SENT</dt><dd>{money(String(entity?.sent ?? 0))} USDC</dd></div>
            <div onMouseEnter={() => setIntent({type: "highlight-transfers", transferIds: related.filter(item => item.to === selected).map(item => item.id)})} onMouseLeave={() => setIntent({type: "reset"})}><dt>RECEIVED</dt><dd>{money(String(entity?.received ?? 0))} USDC</dd></div>
            <div><dt>NET FLOW</dt><dd>{(entity?.netFlow ?? 0) >= 0 ? "+" : ""}{money(String(entity?.netFlow ?? 0))} USDC</dd></div>
            <div><dt>TRANSFERS</dt><dd>{entity?.transferCount ?? related.length}</dd></div>
            <div><dt>COUNTERPARTIES</dt><dd>{entity?.uniqueCounterparties ?? 0}</dd></div>
            {entity?.largestRelated && <div onMouseEnter={() => setIntent({type: "highlight-transfers", transferIds: [entity.largestRelated!.id]})} onMouseLeave={() => setIntent({type: "reset"})}><dt>LARGEST FLOW</dt><dd>{money(String(entity.largestRelated.amount))} USDC</dd></div>}
          </dl>
          <small className="recentLabel">WHY THIS NODE MATTERS</small>
          <p className="entityWhy">{entity?.whyItMatters}</p>
          <button className="askAddress" onClick={() => {setAgentRequest(current => ({id: (current?.id ?? 0) + 1, query: "Explain this address"})); setAgentOpen(true);}}>ASK AERIS ABOUT THIS ADDRESS</button><a className="explorerLink" href={`${ARC.explorer}/address/${selected}`} target="_blank" rel="noreferrer">VIEW ON ARC EXPLORER ↗</a>
        </> : <>
          <small>ARC MAINNET</small>
          <h2>Arc Mainnet</h2>
          <div className={`networkState ${status}`}><i/>{statusLabel}</div>
          <dl>
            <div><dt>CHAIN ID</dt><dd>5042</dd></div>
            <div><dt>ASSET</dt><dd className="coinValue"><UsdcIcon/>USDC</dd></div>
            <div><dt>OBSERVED</dt><dd>{events.length} activities</dd></div>
            <div><dt>VISUALIZED</dt><dd>{Math.min(visualizationCandidates.length, VISUAL_CAPS.desktop.flows)} significant flows</dd></div>
          </dl>
          <p className="panelNote">{status === "stale" ? "Using the last successfully verified observation window." : transfers.length ? "Displaying verified activity from the current live window." : emptyMessage}</p>
        </>}
        <IntelligencePanel snapshot={snapshot} transfers={transfers} selected={selected} connection={status} expanded={agentOpen} request={agentRequest} onExpand={() => setAgentOpen(true)} onClose={() => setAgentOpen(false)} onSelectAddress={address => {select(address); setSelectedTransferId(null);}} onSelectTransfer={id => {const transfer = transfers.find(item => item.id === id); setSelectedTransferId(transfer ? transferIdentity(transfer) : id);}}/>
      </section>

      {!transfers.length && <div className="sceneEmpty"><span>{emptyMessage}</span><small>No simulated activity is shown</small></div>}

      {selectedTransfer && <aside className="transferPanel" aria-label="Selected verified transfer">
        <button className="close" onClick={() => setSelectedTransferId(null)} aria-label="Close selected transfer">×</button>
        <small>SELECTED TRANSFER</small><h3>{shortTransactionHash(selectedTransfer.txHash)}</h3>
        <dl><div><dt>AMOUNT</dt><dd>{money(selectedTransfer.value)} USDC</dd></div><div><dt>FROM</dt><dd>{short(selectedTransfer.from)}</dd></div><div><dt>TO</dt><dd>{short(selectedTransfer.to)}</dd></div><div><dt>BLOCK</dt><dd>{selectedTransfer.blockNumber}</dd></div><div><dt>TYPE</dt><dd>{selectedTransfer.fromType.toUpperCase()} → {selectedTransfer.toType.toUpperCase()}</dd></div></dl>
        <a href={`${ARC.explorer}/tx/${selectedTransfer.txHash}`} target="_blank" rel="noreferrer">VIEW TRANSACTION ↗</a>
      </aside>}

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
      <div className="signalRail"><button className="signal" disabled={!signal} onMouseEnter={() => signal && setIntent(signal.intent)} onMouseLeave={() => setIntent({type: "reset"})} onClick={() => signal && setIntent(signal.intent)}><small>AERIS SIGNAL · {signal?.title ?? "OBSERVING"}</small><p>{signal?.description ?? (status === "stale" ? "Using the last successfully verified observation window." : "No verified activity is available in the current observation window.")}</p></button>{snapshot.signals.length > 1 && <div className="signalSteps"><button onClick={() => setSignalIndex(index => (index - 1 + snapshot.signals.length) % snapshot.signals.length)} aria-label="Previous AERIS signal">‹</button><span>{signalIndex % snapshot.signals.length + 1}/{snapshot.signals.length}</span><button onClick={() => setSignalIndex(index => (index + 1) % snapshot.signals.length)} aria-label="Next AERIS signal">›</button></div>}</div>
    </section>


    <section className="feed">
      <div className="feedHead"><div><small>LIVE LEDGER</small><h2>Recent verified transfers</h2></div><span>{ARC.name} · USDC · REAL-TIME</span></div>
      <div className="feedColumns"><span>FROM</span><span>TO</span><span>AMOUNT</span><span>TYPE</span><span>BLOCK</span></div>
      {filtered.slice().reverse().slice(0, 16).map(transfer => <button className={`feedRow ${activeTransferId === transferIdentity(transfer) ? "active" : ""}`} key={transferIdentity(transfer)} onMouseEnter={() => setHoveredTransferId(transferIdentity(transfer))} onMouseLeave={() => setHoveredTransferId(null)} onFocus={() => setHoveredTransferId(transferIdentity(transfer))} onBlur={() => setHoveredTransferId(null)} onClick={() => setSelectedTransferId(transferIdentity(transfer))}>
        <span className={`party ${transfer.fromType}`}><i/>{short(transfer.from)}</span><span className={`party ${transfer.toType}`}><i/>{short(transfer.to)}</span><b className="coinValue"><UsdcIcon/>{money(transfer.value)} <em>USDC</em></b><span>{transferType(transfer)}</span><small>{transfer.blockNumber}</small>
      </button>)}
      {!filtered.length && <p className="empty">{normalizedQuery ? "No matching verified transfers" : emptyMessage}</p>}
    </section>

    <footer><b>AERIS</b><span>Observe the network. Never invent the data.</span></footer>
  </main>;
}

function Metric({label, value, icon = false}: {label: string; value: string; icon?: boolean}) {
  return <div className="metric"><small>{icon && <UsdcIcon/>}{label}</small><strong>{value}</strong></div>;
}
