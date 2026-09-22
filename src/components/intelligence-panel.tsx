"use client";
import Image from "next/image";
import {useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent} from "react";
import {answerDeterministically, type AerisAnswer} from "@/ai/deterministic";
import type {Transfer} from "@/data/types";
import type {IntelligenceSnapshot} from "@/intelligence/types";
import {money, short} from "@/lib/format";
import {useActivity} from "@/state/activity-store";
import type {Connection} from "@/state/connection";

type AgentRequest = {id: number; query: string} | null;
type Props = {snapshot: IntelligenceSnapshot; transfers: Transfer[]; selected: string | null; connection: Connection; expanded: boolean; request: AgentRequest; onExpand: () => void; onClose: () => void};
const suggestions = ["What’s happening?", "Largest flows", "Active contracts"];
const connectionCopy: Record<Connection, string> = {
  live: "Observing verified Arc activity.", stale: "Using the last verified observation window.", connecting: "Connecting to Arc Mainnet...", unavailable: "Verified Arc activity unavailable.",
};

export function IntelligencePanel({snapshot, transfers, selected, connection, expanded, request, onExpand, onClose}: Props) {
  const [query, setQuery] = useState("");
  const [submitted, setSubmitted] = useState("");
  const [answer, setAnswer] = useState<AerisAnswer | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const setIntent = useActivity(state => state.setVisualizationIntent);
  const intent = useActivity(state => state.visualizationIntent);
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
    if (!next) return;
    onExpand(); setSubmitted(next); setQuery(""); setAnalyzing(true); setAnswer(null);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const result = answerDeterministically(next, snapshot, transfers, selected);
      setAnswer(result); setIntent(result.intent); setAnalyzing(false);
    }, 180);
  }
  useEffect(() => {
    if (request) ask(request.query);
    return () => { if (timer.current) clearTimeout(timer.current); };
    // A request id deliberately triggers repeated analysis of the same selected address.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request?.id]);
  function submit(event: FormEvent) { event.preventDefault(); ask(query); }
  const topFlow = answer?.intent.type === "highlight-transfers" ? snapshot.topFlows.find(flow => answer.intent.type === "highlight-transfers" && answer.intent.transferIds.includes(flow.id)) : null;

  return <section className={`agentModule ${expanded ? "expanded" : "compact"} ${analyzing ? "analyzing" : ""}`} aria-label="AERIS Agent">
    <div className="agentStream" aria-hidden="true">{fragments.map((fragment, index) => <span key={`${fragment}-${index}`} style={{"--row": index, "--speed": `${34 + index % 4 * 7}s`} as CSSProperties}>{fragment}</span>)}</div>
    <div className="agentGlow"/>
    <div className="agentIdentity">
      <Image className="agentPortrait" src="/aeris-agent.png" alt="AERIS Agent" width={90} height={110} priority/>
      <div><div className="agentName">AERIS AGENT <span className={`agentLive ${connection}`}><i/>{connection.toUpperCase()}</span></div><p>Network Observer</p><small>OBSERVE · ANALYZE · EXPLAIN</small></div>
      {expanded && <button className="agentClose" onClick={onClose} aria-label="Close AERIS Agent">×</button>}
    </div>
    {expanded && <div className="agentReport">
      <small>{connection === "live" ? "● LIVE · OBSERVING ARC" : connectionCopy[connection].toUpperCase()}</small>
      {submitted && <div className="reportQuery"><label>USER</label><p>{submitted}</p></div>}
      <div className="reportAnswer"><label>AERIS AGENT · CURRENT OBSERVATION</label><p>{analyzing ? "ANALYZING VERIFIED ACTIVITY..." : answer?.message ?? connectionCopy[connection]}</p>
        {topFlow && !analyzing && <dl><div><dt>AMOUNT</dt><dd>{money(String(topFlow.amount))} USDC</dd></div><div><dt>FROM</dt><dd>{short(topFlow.from)}</dd></div><div><dt>TO</dt><dd>{short(topFlow.to)}</dd></div><div><dt>BLOCK</dt><dd>{topFlow.blockNumber}</dd></div></dl>}
      </div>
    </div>}
    <form className="agentInput" onSubmit={submit}><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Ask about current Arc activity..." aria-label="Ask AERIS Agent about current Arc activity"/><button aria-label="Submit question">→</button></form>
    <div className="agentCommands">{suggestions.map(item => <button key={item} onClick={() => ask(item)}>{item}</button>)}</div>
    <div className="agentFoot"><span>{connectionCopy[connection]}</span>{intent.type !== "reset" && <button onClick={() => setIntent({type: "reset"})}>RESET VIEW</button>}</div>
  </section>;
}
