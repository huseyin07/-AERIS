"use client";
import Image from "next/image";
import {useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent} from "react";
import {answerDeterministically, withObservationStatus, type AerisAnswer} from "@/ai/deterministic";
import {diffSnapshots, makeAgentTrace} from "@/ai/planner";
import type {Transfer} from "@/data/types";
import type {IntelligenceSnapshot} from "@/intelligence/types";
import {money, short} from "@/lib/format";
import {useActivity} from "@/state/activity-store";
import {ARC} from "@/data/arc";
import type {Connection} from "@/state/connection";

type AgentRequest = {id: number; query: string} | null;
type Exchange = {query: string; answer: AerisAnswer};
type Props = {snapshot: IntelligenceSnapshot; transfers: Transfer[]; selected: string | null; connection: Connection; expanded: boolean; request: AgentRequest; onExpand: () => void; onClose: () => void; onSelectAddress: (address: string) => void; onSelectTransfer: (id: string) => void};
const suggestions = ["Figure out what’s interesting", "Trace this flow", "What changed?", "Signals"];
const connectionCopy: Record<Connection, string> = {
  live: "Observing verified Arc activity.", stale: "Using the last verified observation window.", connecting: "Connecting to Arc Mainnet...", unavailable: "Verified Arc activity unavailable.",
};

export function IntelligencePanel({snapshot, transfers, selected, connection, expanded, request, onExpand, onClose, onSelectAddress, onSelectTransfer}: Props) {
  const [query, setQuery] = useState("");
  const [pendingQuery, setPendingQuery] = useState("");
  const [answer, setAnswer] = useState<AerisAnswer | null>(null);
  const [history, setHistory] = useState<Exchange[]>([]);
  const [analyzing, setAnalyzing] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const previousSnapshot = useRef<IntelligenceSnapshot | null>(null);
  const previousTransfers = useRef<Transfer[]>([]);
  const processing = useRef(false);
  const setIntent = useActivity(state => state.setVisualizationIntent);
  const intent = useActivity(state => state.visualizationIntent);
  const health = useActivity(state => state.health);
  const fragments = useMemo(() => {
    const system = ["ARC MAINNET", "CHAIN 5042", "USDC", (connection === "live" || connection === "stale") ? "STATUS VERIFIED" : "WAITING FOR VERIFIED ACTIVITY", "OBSERVING"];
    if (!transfers.length) return system;
    return [...system, ...transfers.slice(-6).flatMap(transfer => [
      `TRANSFER ${short(transfer.from)} → ${short(transfer.to)}`,
      `BLOCK ${transfer.blockNumber} · USDC ${money(transfer.value)}`,
      `${transfer.fromType.toUpperCase()} → ${transfer.toType.toUpperCase()}`,
    ])].slice(0, 16);
  }, [connection, transfers]);

  function ask(value: string) {
    const next = value.trim();
    if (!next || processing.current) return;
    processing.current = true;
    onExpand(); setPendingQuery(next); setQuery(""); setAnalyzing(true); setAnswer(null);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      try {
        const delta = diffSnapshots(previousSnapshot.current, snapshot, previousTransfers.current, transfers);
        const result = connection === "connecting" && !transfers.length
          ? {message: "Connecting to Arc Mainnet...", summary: "Connecting to Arc Mainnet...", evidence: [], relatedAddresses: [], relatedTransferIds: [], intent: {type: "reset"} as const, scope: "current-window" as const}
          : connection === "unavailable" && !transfers.length
            ? {message: "Verified Arc activity is currently unavailable.", summary: "Verified Arc activity is currently unavailable.", evidence: [], relatedAddresses: [], relatedTransferIds: [], intent: {type: "reset"} as const, scope: "current-window" as const}
            : withObservationStatus(answerDeterministically(next, snapshot, transfers, selected, {
                address: history.at(-1)?.answer.relatedAddresses[0] ?? selected,
                previousAddress: history.at(-2)?.answer.relatedAddresses[0] ?? null,
                transferId: history.at(-1)?.answer.relatedTransferIds[0] ?? null,
                delta,
              }), connection);
        setAnswer(result); setHistory(current => [...current, {query: next, answer: result}].slice(-8)); setIntent(result.intent);
        previousSnapshot.current = snapshot; previousTransfers.current = transfers.slice();
      } catch (error) {
        console.error("AERIS deterministic analysis failed", error);
        const failure: AerisAnswer = {message: "AERIS could not analyze the current observation. Try again.", summary: "AERIS could not analyze the current observation. Try again.", evidence: [], relatedAddresses: [], relatedTransferIds: [], intent: {type: "reset"}, scope: "current-window", trace: makeAgentTrace([], 0, 0)};
        setAnswer(failure); setHistory(current => [...current, {query: next, answer: failure}].slice(-6));
      } finally {
        processing.current = false; setAnalyzing(false);
      }
    }, 180);
  }
  useEffect(() => {
    if (request) ask(request.query);
    return () => { if (timer.current) clearTimeout(timer.current); processing.current = false; };
    // A request id deliberately triggers repeated analysis of the same selected address.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request?.id]);
  function submit(event: FormEvent) { event.preventDefault(); ask(query); }
  const topFlow = answer?.intent.type === "highlight-transfers" ? snapshot.topFlows.find(flow => answer.intent.type === "highlight-transfers" && answer.intent.transferIds.includes(flow.id)) : null;
  const previousExchanges = analyzing ? history : history.slice(0, -1);

  return <section className={`agentModule ${expanded ? "expanded" : "compact"} ${analyzing ? "analyzing" : ""}`} aria-label="AERIS Agent">
    <div className="agentStream" aria-hidden="true">{fragments.map((fragment, index) => <span key={`${fragment}-${index}`} style={{"--row": index, "--speed": `${34 + index % 4 * 7}s`} as CSSProperties}>{fragment}</span>)}</div>
    <div className="agentGlow"/>
    <div className="agentIdentity">
      <Image className="agentPortrait" src="/aeris-agent.png" alt="AERIS Agent" width={90} height={110} priority/>
      <div><div className="agentName">AERIS AGENT <span className={`agentLive ${connection}`}><i/>{connection.toUpperCase()}</span></div><p>Network Observer</p><small>OBSERVE · ANALYZE · EXPLAIN</small></div>
      {expanded && <button className="agentClose" onClick={onClose} aria-label="Close AERIS Agent">×</button>}
    </div>
    {expanded && <div className="agentReport">
      <small>{health.status === "partial" ? "◐ PARTIAL · VERIFIED DATA MAY BE INCOMPLETE" : connection === "live" ? "● LIVE · OBSERVING ARC" : connectionCopy[connection].toUpperCase()}</small>
      <div className="agentHistory">{previousExchanges.map((exchange, index) => <div className="pastExchange" key={`${exchange.query}-${index}`}><label>USER</label><p>{exchange.query}</p><label>AERIS AGENT</label><p>{exchange.answer.message}</p></div>)}</div>
      {(analyzing || history.at(-1)) && <div className="reportQuery"><label>USER</label><p>{analyzing ? pendingQuery : history.at(-1)?.query}</p></div>}
      <div className="reportAnswer"><label>ANALYSIS · {health.status === "partial" ? "PARTIAL VERIFIED OBSERVATION" : connection === "stale" ? "LAST VERIFIED OBSERVATION" : "CURRENT OBSERVATION"} · {snapshot.transferCount.toLocaleString()} VERIFIED TRANSFERS</label><p>{analyzing ? "ANALYZING VERIFIED ACTIVITY..." : answer ? (health.status === "partial" ? `Partial observation: some Arc data may be incomplete. ${answer.summary}` : answer.summary) : connectionCopy[connection]}</p>
        {!analyzing && answer && <small className="agentTrace">{answer.trace.toolsUsed.length} TOOLS · {answer.trace.entitiesInspected} ENTITIES · {answer.trace.transfersEvaluated} TRANSFERS EVALUATED</small>}
        {topFlow && !analyzing && <dl><div><dt>AMOUNT</dt><dd>{money(String(topFlow.amount))} USDC</dd></div><div><dt>FROM</dt><dd>{short(topFlow.from)}</dd></div><div><dt>TO</dt><dd>{short(topFlow.to)}</dd></div><div><dt>BLOCK</dt><dd>{topFlow.blockNumber}</dd></div></dl>}
        {!analyzing && answer?.evidence.length ? <div className="agentEvidence"><label>EVIDENCE</label>{answer.evidence.map((item, index) => <div className="agentEvidenceRow" key={`${item.text}-${index}`}><button onMouseEnter={() => item.transferId ? setIntent({type: "highlight-transfers", transferIds: [item.transferId]}) : item.address ? setIntent({type: "highlight-addresses", addresses: [item.address]}) : undefined} onMouseLeave={() => answer && setIntent(answer.intent)} onClick={() => item.transferId ? onSelectTransfer(item.transferId) : item.address ? onSelectAddress(item.address) : undefined}>• {item.text}</button>{item.txHash ? <a href={`${ARC.explorer}/tx/${item.txHash}`} target="_blank" rel="noreferrer" aria-label="Open transaction in Arcscan">TX ↗</a> : item.address ? <a href={`${ARC.explorer}/address/${item.address}`} target="_blank" rel="noreferrer" aria-label="Open address in Arcscan">ADDRESS ↗</a> : null}</div>)}</div> : null}
        {!analyzing && answer && answer.intent.type !== "reset" && <button className="agentAction" onClick={() => setIntent(answer.intent)}>SHOW IN NETWORK</button>}
      </div>
    </div>}
    <form className="agentInput" onSubmit={submit}><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Ask about current Arc activity..." aria-label="Ask AERIS Agent about current Arc activity" disabled={analyzing}/><button type="submit" aria-label="Submit question" disabled={!query.trim() || analyzing}>→</button></form>
    <div className="agentCommands">{suggestions.map(item => <button type="button" key={item} disabled={analyzing} onClick={() => ask(item)}>{item}</button>)}</div>
    <div className="agentFoot"><span>{connectionCopy[connection]}</span>{intent.type !== "reset" && <button onClick={() => setIntent({type: "reset"})}>RESET VIEW</button>}</div>
  </section>;
}
