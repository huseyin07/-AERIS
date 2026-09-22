"use client";
import {useState, type FormEvent} from "react";
import {answerDeterministically} from "@/ai/deterministic";
import type {Transfer} from "@/data/types";
import type {IntelligenceSnapshot} from "@/intelligence/types";
import {money, short} from "@/lib/format";
import {useActivity} from "@/state/activity-store";

type Props = {snapshot: IntelligenceSnapshot; transfers: Transfer[]; selected: string | null; onClose: () => void};
export function IntelligencePanel({snapshot, transfers, selected, onClose}: Props) {
  const [query, setQuery] = useState("");
  const [answer, setAnswer] = useState(() => selected
    ? answerDeterministically("explain this address", snapshot, transfers, selected).message
    : "Deterministic intelligence active. Ask about the current verified observation window.");
  const setIntent = useActivity(state => state.setVisualizationIntent);
  function ask(value: string) {
    const result = answerDeterministically(value, snapshot, transfers, selected);
    setAnswer(result.message); setIntent(result.intent); setQuery("");
  }
  function submit(event: FormEvent) { event.preventDefault(); if (query.trim()) ask(query); }
  return <aside className="intelligenceDrawer" aria-label="AERIS intelligence">
    <div className="drawerHead"><div><small>AERIS INTELLIGENCE</small><h2>Current observation window</h2></div><button onClick={onClose} aria-label="Close insights">×</button></div>
    <section><small>OVERVIEW</small><dl><div><dt>OBSERVED USDC</dt><dd>{money(String(snapshot.totalVolume))}</dd></div><div><dt>TRANSFERS</dt><dd>{snapshot.transferCount}</dd></div><div><dt>ADDRESSES</dt><dd>{snapshot.uniqueAddresses}</dd></div><div><dt>CONTRACTS</dt><dd>{snapshot.activeContracts}</dd></div></dl></section>
    <section><small>TOP FLOWS</small>{snapshot.topFlows.slice(0, 4).map(item => <button className="intelRow" key={item.id} onClick={() => setIntent({type: "highlight-transfers", transferIds: [item.id]})}><span>{short(item.from)} → {short(item.to)}</span><b>{money(String(item.amount))} USDC</b></button>)}</section>
    <section><small>TOP RECEIVERS</small>{snapshot.topReceivers.slice(0, 4).map(item => <button className="intelRow" key={item.address} onClick={() => setIntent({type: "highlight-addresses", addresses: [item.address]})}><span>{short(item.address)}</span><b>{money(String(item.received))}</b></button>)}</section>
    <section><small>ACTIVE CONTRACTS</small>{snapshot.topContracts.slice(0, 3).map(item => <button className="intelRow" key={item.address} onClick={() => setIntent({type: "highlight-addresses", addresses: [item.address]})}><span>{short(item.address)} · {item.uniqueCounterparties} peers</span><b>{item.transferCount} flows</b></button>)}</section>
    <section><small>AERIS SIGNALS</small>{snapshot.signals.map(signal => <button className="intelRow" key={signal.id} onClick={() => setIntent({type: "highlight-transfers", transferIds: signal.relatedTransferIds})}><span>{signal.title}</span><b>{signal.metric.value.toFixed(signal.metric.unit === "count" ? 0 : 1)} {signal.metric.unit === "percent" ? "%" : signal.metric.unit === "count" ? "" : signal.metric.unit}</b></button>)}</section>
    <section><small>ACTIVITY MIX</small>{snapshot.activityBreakdown.map(item => <div className="mixRow" key={item.category}><span>{item.category.replaceAll("-", " ")}</span><i><b style={{width: `${item.transferPercent}%`}}/></i><em>{item.transferPercent.toFixed(1)}%</em></div>)}</section>
    <section className="askAeris"><small>ASK AERIS</small><p>{answer}</p><form onSubmit={submit}><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Ask about current Arc activity…"/><button>ASK</button></form><div className="suggestions">{["What’s happening now?", "Show largest flows", "Active contracts", "Where is USDC concentrating?"].map(item => <button key={item} onClick={() => ask(item)}>{item}</button>)}</div></section>
  </aside>;
}
