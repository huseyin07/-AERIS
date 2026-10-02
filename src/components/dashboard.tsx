"use client";

import dynamic from "next/dynamic";
import Image from "next/image";
import {useCallback, useEffect, useMemo, useRef, useState} from "react";
import {LiveActivity} from "./live-activity";
import {useEndpointTypes} from "./use-endpoint-types";
import {VisualizationBoundary} from "./visualization-boundary";
import {NetworkFallback} from "./network-fallback";
import {IntelligencePanel} from "./intelligence-panel";
import {useActivity} from "@/state/activity-store";
import {money, short} from "@/lib/format";
import {ARC} from "@/data/arc";
import type {Transfer} from "@/data/types";
import {buildIntelligenceSnapshot, getEntityIntelligence} from "@/intelligence/engine";
import {shortTransactionHash, transferIdentity} from "@/visualization/network-model";
import {healthLabel, relativeActivityTime, resolveTransferEndpointTypes, searchObservation, sliceObservationWindow, visibleEvents, visibleTransfers} from "@/lib/activity-ui";

const NetworkScene = dynamic(
  () => import("@/visualization/network-scene").then(module => module.NetworkScene),
  {ssr: false, loading: () => <div className="sceneFallback">Loading observatory…</div>},
);

function UsdcIcon({className = ""}: {className?: string}) {
  return <Image className={`usdcIcon ${className}`} src="/usdc.svg" alt="" width={16} height={16}/>;
}

function transferType(transfer: Transfer, endpointTypes: Record<string, "wallet" | "contract" | "unknown">) {
  const toType = transfer.toType === "unknown" ? endpointTypes[transfer.to.toLowerCase()] : transfer.toType;
  const fromType = transfer.fromType === "unknown" ? endpointTypes[transfer.from.toLowerCase()] : transfer.fromType;
  if (toType === "contract") return "CONTRACT IN";
  if (fromType === "contract") return "CONTRACT OUT";
  return "TRANSFER";
}

export function Dashboard() {
  const observedTransfers = useActivity(state => state.transfers);
  const observedEvents = useActivity(state => state.events);
  const referenceTimestamp = useActivity(state => state.observationReferenceTimestamp);
  const [rangeMinutes, setRangeMinutes] = useState<1 | 5 | 10>(10);
  const windowed = useMemo(() => sliceObservationWindow(observedTransfers, observedEvents, referenceTimestamp, rangeMinutes), [observedTransfers, observedEvents, referenceTimestamp, rangeMinutes]);
  const visible = useMemo(() => visibleTransfers(windowed.transfers), [windowed.transfers]);
  const events = useMemo(() => visibleEvents(windowed.events), [windowed.events]);
  const endpointTypes = useEndpointTypes(visible);
  const transfers = useMemo(() => resolveTransferEndpointTypes(visible, endpointTypes), [visible, endpointTypes]);
  const status = useActivity(state => state.connection);
  const health = useActivity(state => state.health);
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
  const [resetViewToken, setResetViewToken] = useState(0);
  const [signalIndex, setSignalIndex] = useState(0);
  const [inspectedSignalId, setInspectedSignalId] = useState<string | null>(null);
  const [sceneFailed, setSceneFailed] = useState(false);
  const [sceneMode, setSceneMode] = useState<"auto" | "2d" | "3d">("auto");
  const [lowPower, setLowPower] = useState(false);
  const [healthOpen, setHealthOpen] = useState(false);
  const [clock, setClock] = useState(() => Date.now());
  const feedRef = useRef<HTMLElement>(null);
  const entityPanelRef = useRef<HTMLElement>(null);
  const previousQuery = useRef("");
  const snapshot = useMemo(() => buildIntelligenceSnapshot(transfers, referenceTimestamp ?? Date.now(), events), [transfers, events, referenceTimestamp]);

  const volume = snapshot.totalVolume;
  const addresses = snapshot.uniqueAddresses;
  const contracts = snapshot.activeContracts;
  const largest = transfers.find(transfer => transfer.id === snapshot.largestTransfer?.id);

  const search = useMemo(() => searchObservation(transfers, events, query), [transfers, events, query]);
  const normalizedQuery = query.trim().toLowerCase();
  const filtered = search.transfers;
  const activeTransferId = hoveredTransferId ?? selectedTransferId;
  const selectedTransfer = transfers.find(transfer => transferIdentity(transfer) === selectedTransferId) ?? null;
  const selectedEvent = selectedTransfer ? events.find(event => event.type === "USDC_TRANSFER" && event.transactionHash.toLowerCase() === selectedTransfer.txHash.toLowerCase() && event.logIndex === selectedTransfer.logIndex) : null;
  const selectSceneAddress = useCallback((address: string) => { select(address); setSelectedTransferId(null); }, [select]);

  useEffect(() => {
    if (!normalizedQuery) {
      if (previousQuery.current) { select(null); setSelectedTransferId(null); setIntent({type: "reset"}); }
    } else if (search.kind === "transaction") {
      const match = search.transfers[0];
      setSelectedTransferId(match ? transferIdentity(match) : null);
      if (match) setIntent({type: "highlight-transfers", transferIds: [match.id]});
      else if (search.matchedEvent) { select(search.matchedEvent.to); setIntent({type: "highlight-addresses", addresses: [search.matchedEvent.to]}); }
      else { select(null); setIntent({type: "reset"}); }
    } else if (search.kind === "address") {
      select(search.matchedAddress);
      setSelectedTransferId(null);
      if (search.matchedAddress) setIntent({type: "highlight-addresses", addresses: [search.matchedAddress]});
    }
    previousQuery.current = normalizedQuery;
  }, [normalizedQuery, search, select, setIntent]);

  useEffect(() => {
    const timer = setInterval(() => setClock(Date.now()), 15_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const memory = (navigator as Navigator & {deviceMemory?: number}).deviceMemory;
    const update = () => setLowPower(media.matches || (navigator.hardwareConcurrency > 0 && navigator.hardwareConcurrency <= 4) || (memory !== undefined && memory <= 4));
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (!selectedTransferId) return;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    feedRef.current?.querySelector<HTMLElement>(`[data-transfer-id="${selectedTransferId}"]`)?.scrollIntoView({block: "nearest", behavior: reducedMotion ? "auto" : "smooth"});
  }, [selectedTransferId]);

  const related = selected
    ? transfers.filter(transfer => transfer.from === selected || transfer.to === selected)
    : [];
  const entity = selected ? getEntityIntelligence(snapshot, selected) : null;
  const emptyMessage = status === "unavailable" ? "Live data temporarily unavailable" : status === "connecting" ? "Waiting for verified Arc Mainnet activity" : `No transfers ≥1,000 USDC in the last ${rangeMinutes} minutes of verified activity`;
  const signal = snapshot.signals[signalIndex % Math.max(1, snapshot.signals.length)];
  const inspectedSignal = snapshot.signals.find(item => item.id === inspectedSignalId);
  const statusLabel = healthLabel(status, health, clock);
  const show2D = sceneFailed || sceneMode === "2d" || (sceneMode === "auto" && lowPower);
  const healthDetails = [health.latestBlock ? `Latest block ${health.latestBlock}` : "", health.processedBlockRange ? `USDC blocks ${health.processedBlockRange.from}–${health.processedBlockRange.to}` : "", health.contractSampleBlockRange ? `Contract sample ${health.contractSampleBlockRange.from}–${health.contractSampleBlockRange.to}` : "", health.lastSuccessfulAt ? `Updated ${relativeActivityTime(health.lastSuccessfulAt, clock)}` : "", ...health.rpcWarnings].filter(Boolean).join(" · ");
  const annotations = useMemo(() => [...new Map([
    ...(selected ? [{address: selected, label: "SELECTED ENTITY"}] : []),
    ...(intent.type === "highlight-addresses" ? intent.addresses.map(address => ({address, label: "AERIS FOCUS"})) : []),
    ...(signal?.relatedAddresses.slice(0, 1).map(address => ({address, label: signal.title})) ?? []),
    ...(snapshot.entities.length >= 3 && snapshot.mostActiveByCount[0]?.transferCount > 1 ? [{address: snapshot.mostActiveByCount[0].address, label: snapshot.mostActiveByCount[0].type === "contract" ? "CONTRACT HUB" : "HIGH ACTIVITY"}] : []),
  ].map(item => [item.address.toLowerCase(), item])).values()], [selected, intent, signal, snapshot.entities.length, snapshot.mostActiveByCount]);

  function inspectSignal() {
    if (!signal) return;
    setInspectedSignalId(signal.id);
    setIntent(signal.intent);
    const related = transfers.find(item => signal.relatedTransferIds.includes(item.id));
    if (related) setSelectedTransferId(transferIdentity(related));
    else if (signal.relatedAddresses[0] && snapshot.entities.some(item => item.address.toLowerCase() === signal.relatedAddresses[0].toLowerCase())) {
      select(signal.relatedAddresses[0]);
      entityPanelRef.current?.scrollIntoView({block: "nearest", behavior: "smooth"});
    }
  }

  return <main>
    <LiveActivity/>
    <header>
      <div className="brand"><Image className="brandMark" src="/aeris-logo.jpg" alt="" width={18} height={18}/>AERIS</div>
      <nav aria-label="Dashboard sections"><b>LIVE</b><button onClick={() => setAgentOpen(true)}>INSIGHTS</button></nav>
      <a className="headerSocial" href="https://x.com/AERIS_arc" target="_blank" rel="noopener noreferrer" aria-label="AERIS on X">X <span aria-hidden="true">↗</span></a>
      <input
        className="search"
        value={query}
        onChange={event => setQuery(event.target.value)}
        placeholder="Search full address or transaction hash"
        aria-label="Search full address or transaction hash"
      />
      <button className={`status ${statusLabel.toLowerCase()}`} type="button" title={healthDetails || "Awaiting the first verified Arc Mainnet response"} aria-expanded={healthOpen} aria-controls="data-health" onClick={() => setHealthOpen(value => !value)}><i/><span>ARC MAINNET<span className="statusDetail"> · {statusLabel}</span></span><span aria-hidden="true">⌄</span></button>
    </header>

    <section className="competitionHero" aria-label="AERIS autonomous intelligence">
      <div className="competitionHeroCopy"><small>AUTONOMOUS USDC INTELLIGENCE · ARC MAINNET</small><h1>Watch money move.<br/><span>Understand what happens next.</span></h1><p>AERIS observes verified USDC activity, investigates material signals, applies deterministic policy, and produces verifiable evidence.</p></div>
      <div className="competitionHeroProof"><span><i className={status === "live" ? "live" : ""}/>REAL DATA</span><span>STATEFUL AGENT</span><span>POLICY-GATED</span><span>VERIFIABLE PROOF</span></div>
    </section>
    <section className="agentLifecycleRail" aria-label="AERIS agent lifecycle">
      <div className="lifecycleLead"><small>AERIS AGENT</small><strong>{status === "live" ? "ACTIVE · OBSERVING" : status.toUpperCase()}</strong></div>
      {["OBSERVE","REASON","PLAN","POLICY","ACT","VERIFY","MEMORY"].map((phase,index)=><div className={"lifecycleStage "+(index < 4 ? "ready" : "gated")} key={phase}><span>{String(index+1).padStart(2,"0")}</span><strong>{phase}</strong><small>{index < 4 ? "READY" : index === 4 ? "CIRCLE PENDING" : "PROOF-GATED"}</small></div>)}
    </section>

    {healthOpen && <section className="healthPanel" id="data-health" aria-label="Arc Mainnet data health">
      <div className="healthPanelHead"><div><small>DATA HEALTH · {statusLabel}</small><h2>Verified observation coverage</h2></div><button type="button" onClick={() => setHealthOpen(false)} aria-label="Close data health">×</button></div>
      <p>USDC transfers cover the chain-relative window when the scan completes. Contract calls and deployments sample up to 32 eligible transactions from the latest six blocks; their counts are not full-window totals. Known contracts reflect classified transfer endpoints only.</p>
      <dl><div><dt>USDC WINDOW</dt><dd>{health.windowCovered === undefined ? "Awaiting data" : health.windowCovered ? "Complete" : "Partial"}{health.blocksScanned ? ` · ${health.blocksScanned.toLocaleString()} blocks` : ""}</dd></div><div><dt>CONTRACT SAMPLE</dt><dd>{health.contractSampleBlockRange ? `${health.contractSampleBlockRange.from}–${health.contractSampleBlockRange.to}` : "Awaiting data"}{health.contractCandidateCount !== undefined ? ` · ${health.contractCandidateCount} candidates${health.contractCandidateTruncated ? " (capped)" : ""}` : ""}</dd></div><div><dt>REQUEST LOAD</dt><dd>{health.rpcRequestCount === undefined ? "Awaiting data" : `${health.rpcRequestCount} RPC calls`}{health.ingestionMs !== undefined ? ` · ${Math.round(health.ingestionMs)} ms ingest` : ""}{health.responseMs !== undefined ? ` · ${health.responseMs} ms response` : ""}</dd></div><div><dt>LAST VERIFIED</dt><dd>{health.lastSuccessfulAt ? relativeActivityTime(health.lastSuccessfulAt, clock) : "Awaiting data"}</dd></div></dl>
      {health.rpcWarnings.length > 0 && <p className="healthWarnings">{health.rpcWarnings.join(" · ")}</p>}
    </section>}

    <section className="observatory competitionObservatory">
      <div className="scene" aria-label="Live Arc Mainnet entity network">
        {show2D ? <NetworkFallback transfers={transfers} endpointTypes={endpointTypes} selectedAddress={selected} selectedTransferId={activeTransferId} onSelectAddress={selectSceneAddress} onSelectTransfer={setSelectedTransferId} reason={sceneFailed ? "unavailable" : "lightweight"}/> : <VisualizationBoundary onFailure={() => setSceneFailed(true)} fallback={<NetworkFallback transfers={transfers} endpointTypes={endpointTypes} selectedAddress={selected} selectedTransferId={activeTransferId} onSelectAddress={selectSceneAddress} onSelectTransfer={setSelectedTransferId}/> }>
          <NetworkScene transfers={transfers} endpointTypes={endpointTypes} annotations={annotations} selectedAddress={selected} selectedTransferId={activeTransferId} resetViewToken={resetViewToken} intent={intent} onSelectAddress={selectSceneAddress} onSelectTransfer={setSelectedTransferId}/>
        </VisualizationBoundary>}
        {!sceneFailed && <button className="modeSwitch" type="button" onClick={() => setSceneMode(show2D ? "3d" : "2d")} aria-label={show2D ? "Switch to 3D network" : "Switch to 2D network"}>{show2D ? "TRY 3D" : "USE 2D"}</button>}
        {!show2D && <button className="resetView" type="button" onClick={() => setResetViewToken(token => token + 1)} aria-label="Reset globe camera view" title="Reset globe camera view">RESET VIEW <span aria-hidden="true">↺</span></button>}
      </div>

      <section className="metrics" aria-label="Live metrics"><div className="panelKicker">LIVE NETWORK · 10M</div>
        <p className="eyebrow">VERIFIED {rangeMinutes}M ACTIVITY · ≥1,000 USDC</p>
        <div className="assetHeading"><UsdcIcon/><span>ARC MAINNET USDC</span></div>
        <Metric icon primary label="USDC FLOW" value={`$${money(String(volume))}`}/>
        <Metric label="TRANSFERS" value={String(transfers.length)}/>
        <Metric label="ACTIVE ADDRESSES" value={String(addresses)}/>
        <Metric label="KNOWN CONTRACTS" value={String(contracts)}/>
        <Metric icon label="LARGEST TRANSFER" value={largest ? `${money(largest.value)} USDC` : "—"}/>
      </section>

      <section className="entityPanel commandCenterShell" ref={entityPanelRef}><div className="panelKicker">COMMAND CENTER · EVIDENCE FIRST</div>
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
          <div className={`networkState ${statusLabel.toLowerCase()}`} title={healthDetails}><i/>{statusLabel}</div>
          <dl>
            <div><dt>CHAIN ID</dt><dd>5042</dd></div>
            <div><dt>ASSET</dt><dd className="coinValue"><UsdcIcon/>USDC</dd></div>
            <div><dt>OBSERVED</dt><dd>{events.length} events</dd></div>
            <div><dt>VISUALIZED</dt><dd>{Math.min(transfers.length, 44)} significant flows</dd></div>
          </dl>
          <p className="panelNote">{status === "stale" ? "Using the last successfully verified observation window." : transfers.length ? `${health.windowCovered === false ? "USDC window partially covered" : "USDC window observed"}; contract events sample recent blocks.` : emptyMessage}</p>
        </>}
        <IntelligencePanel snapshot={snapshot} transfers={transfers} selected={selected} connection={status} expanded={agentOpen} visualizationAvailable={!show2D} request={agentRequest} onExpand={() => setAgentOpen(true)} onClose={() => setAgentOpen(false)} onSelectAddress={address => {select(address); setSelectedTransferId(null);}} onSelectTransfer={id => {const transfer = transfers.find(item => item.id === id); setSelectedTransferId(transfer ? transferIdentity(transfer) : id);}}/>
      </section>

      {!transfers.length && !show2D && <div className="sceneEmpty"><span>{emptyMessage}</span><small>No simulated activity is shown</small></div>}

      {selectedTransfer && <aside className="transferPanel" aria-label="Selected verified transfer">
        <button className="close" onClick={() => setSelectedTransferId(null)} aria-label="Close selected transfer">×</button>
        <small>SELECTED TRANSFER</small><h3>{shortTransactionHash(selectedTransfer.txHash)}</h3>
        <dl><div><dt>AMOUNT</dt><dd>{money(selectedTransfer.value)} USDC</dd></div><div><dt>FROM</dt><dd title={selectedTransfer.from}>{short(selectedTransfer.from)}</dd></div><div><dt>TO</dt><dd title={selectedTransfer.to}>{short(selectedTransfer.to)}</dd></div><div><dt>BLOCK</dt><dd>{selectedTransfer.blockNumber}</dd></div><div><dt>TIME</dt><dd>{relativeActivityTime(selectedTransfer.timestamp, clock)}</dd></div><div><dt>STATUS</dt><dd>{selectedEvent?.status?.toUpperCase() ?? "UNKNOWN"}</dd></div><div><dt>ACTIVITY</dt><dd>{transferType(selectedTransfer, endpointTypes)} · USDC</dd></div><div><dt>CONTRACT</dt><dd title={ARC.usdc}>{short(ARC.usdc)}</dd></div></dl>
        <button className="explainTransfer" onClick={() => {setAgentRequest(current => ({id: (current?.id ?? 0) + 1, query: `Explain transaction ${selectedTransfer.txHash}`})); setAgentOpen(true);}}>EXPLAIN VERIFIED TRANSFER</button>
        <a href={`${ARC.explorer}/tx/${selectedTransfer.txHash}`} target="_blank" rel="noopener noreferrer" aria-label={`View transaction ${selectedTransfer.txHash} on Arcscan`}>VIEW ON ARCSCAN ↗</a>
      </aside>}

      {!show2D && <div className="legend">
        <div className="legendRow"><span><i className="wallet"/>WALLET</span><span><i className="contract"/>CONTRACT</span><span><i className="unknown"/>UNKNOWN</span><span><i className="flow"/>USDC ≥1K</span></div>
        <div className="legendRow flowTypes" aria-label="Transfer endpoint colors"><span title="Wallet to wallet"><i className="pulseWallet"/>W→W</span><span title="Wallet to contract"><i className="pulseContractIn"/>W→C</span><span title="Contract to wallet"><i className="pulseContractOut"/>C→W</span><span title="Unclassified endpoint"><i className="pulseUnknown"/>UNKNOWN</span></div>
      </div>}
    </section>

    <section className="lowerBar">
      <div className="timeControls" aria-label="Activity time range">
        <span className={`liveBadge ${statusLabel === "LIVE" ? "" : "observed"}`}>{statusLabel === "LIVE" ? "LIVE" : "OBSERVED"}</span>
        {([1, 5, 10] as const).map(minutes => <button type="button" key={minutes} className={rangeMinutes === minutes ? "active" : ""} aria-pressed={rangeMinutes === minutes} onClick={() => {setRangeMinutes(minutes); setSelectedTransferId(null); setInspectedSignalId(null); setIntent({type: "reset"});}}>{minutes}M</button>)}
        <small>CHAIN-RELATIVE VERIFIED WINDOW · UP TO 10 MINUTES</small>
      </div>
      <div className="signalRail"><button className="signal" disabled={!signal} onClick={inspectSignal} title={signal ? "Inspect verified evidence" : undefined}><small>AERIS SIGNAL · {signal?.title ?? "OBSERVING"}</small><p>{signal?.description ?? (status === "stale" ? "Using the last successfully verified observation window." : "No verified activity is available in the current observation window.")}</p></button>{snapshot.signals.length > 1 && <div className="signalSteps"><button onClick={() => {setInspectedSignalId(null); setSignalIndex(index => (index - 1 + snapshot.signals.length) % snapshot.signals.length);}} aria-label="Previous AERIS signal">‹</button><span>{signalIndex % snapshot.signals.length + 1}/{snapshot.signals.length}</span><button onClick={() => {setInspectedSignalId(null); setSignalIndex(index => (index + 1) % snapshot.signals.length);}} aria-label="Next AERIS signal">›</button></div>}</div>
    </section>

    {inspectedSignal && <section className="signalDetails" aria-label="Selected AERIS signal evidence">
      <div className="signalDetailsHead"><div><small>VERIFIED SIGNAL · {rangeMinutes}M WINDOW</small><h3>{inspectedSignal.title}</h3></div><button type="button" onClick={() => setInspectedSignalId(null)} aria-label="Close signal evidence">×</button></div>
      <p>{inspectedSignal.description}</p>
      <dl>{inspectedSignal.evidence.map(item => <div key={item.label}><dt>{item.label}</dt><dd>{item.value.toLocaleString("en-US", {maximumFractionDigits: 2})}{item.unit === "percent" ? "%" : item.unit === "USDC" ? " USDC" : ""}</dd></div>)}</dl>
      {inspectedSignal.relatedAddresses[0] && <a href={`${ARC.explorer}/address/${inspectedSignal.relatedAddresses[0]}`} target="_blank" rel="noopener noreferrer">VIEW RELATED ADDRESS ON ARCSCAN ↗</a>}
    </section>}


    <section className="feed" id="live-ledger" ref={feedRef}>
      <div className="feedHead"><div><small>VERIFIED {rangeMinutes}M LEDGER · MIN 1,000 USDC</small><h2>Recent verified transfers <span className="feedCount">{Math.min(filtered.length, 16)} / {filtered.length} shown</span></h2></div><span>{ARC.name} · USDC · {statusLabel === "LIVE" ? "REAL-TIME" : "LAST VERIFIED WINDOW"}</span></div>
      {selectedTransfer && <div className="feedSelection" role="status">
        <div><small>SELECTED VERIFIED TRANSFER</small><strong>{money(selectedTransfer.value)} USDC</strong><span>{short(selectedTransfer.from)} → {short(selectedTransfer.to)} · {shortTransactionHash(selectedTransfer.txHash)}</span></div>
        <div className="feedSelectionActions"><a href={`${ARC.explorer}/tx/${selectedTransfer.txHash}`} target="_blank" rel="noopener noreferrer">ARCSCAN ↗</a><button type="button" onClick={() => setSelectedTransferId(null)} aria-label="Clear selected transfer">×</button></div>
      </div>}
      <div className="feedColumns"><span>FROM</span><span>TO</span><span>AMOUNT</span><span>TYPE</span><span>BLOCK</span><span>TIME</span></div>
      {filtered.slice(0, 16).map(transfer => <button data-transfer-id={transferIdentity(transfer)} className={`feedRow ${activeTransferId === transferIdentity(transfer) ? "active" : ""}`} key={transferIdentity(transfer)} onMouseEnter={() => setHoveredTransferId(transferIdentity(transfer))} onMouseLeave={() => setHoveredTransferId(null)} onFocus={() => setHoveredTransferId(transferIdentity(transfer))} onBlur={() => setHoveredTransferId(null)} onClick={() => setSelectedTransferId(transferIdentity(transfer))} aria-pressed={selectedTransferId === transferIdentity(transfer)}>
        <span className={`party ${transfer.fromType === "unknown" ? endpointTypes[transfer.from.toLowerCase()] ?? "unknown" : transfer.fromType}`} title={transfer.from}><i/>{short(transfer.from)}</span><span className={`party ${transfer.toType === "unknown" ? endpointTypes[transfer.to.toLowerCase()] ?? "unknown" : transfer.toType}`} title={transfer.to}><i/>{short(transfer.to)}</span><b className="coinValue" title={`${transfer.value} USDC`}><UsdcIcon/>{money(transfer.value)} <em>USDC</em></b><span className="transferKind">{transferType(transfer, endpointTypes)}</span><small>{transfer.blockNumber}</small><time dateTime={transfer.timestamp ? new Date(transfer.timestamp).toISOString() : undefined}>{relativeActivityTime(transfer.timestamp, clock)}</time>
      </button>)}
      {!filtered.length && <p className="empty">{search.matchedEvent ? "Verified activity found; no matching USDC transfers." : search.kind === "address" || search.kind === "transaction" ? "No verified activity in the current observation window." : emptyMessage}</p>}
    </section>

    <footer><b>AERIS</b><span>Observe the network. Never invent the data.</span></footer>
  </main>;
}

function Metric({label, value, icon = false, primary = false}: {label: string; value: string; icon?: boolean; primary?: boolean}) {
  return <div className={`metric ${primary ? "metricPrimary" : ""}`}><small>{icon && <UsdcIcon/>}{label}</small><strong>{value}</strong></div>;
}
