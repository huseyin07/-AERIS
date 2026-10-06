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
import {baselineSummary, compareMemory, createAgentState, loadAgentState, recordBaseline, remember, recordRun, saveAgentState} from "@/agent/state";
import type {AgentState} from "@/agent/types";
import {proposeObservationAction, type ProposedAction} from "@/agent/decision-engine";
import {createRun, memoryKindFor, sentinelSignature, shouldTriggerProactively} from "@/agent/runtime";
import {ledgerEntry} from "@/agent/ledger";

type AgentRequest = {id: number; query: string} | null;
type Exchange = {query: string; answer: AerisAnswer};
type Props = {snapshot: IntelligenceSnapshot; transfers: Transfer[]; selected: string | null; connection: Connection; expanded: boolean; visualizationAvailable: boolean; request: AgentRequest; onExpand: () => void; onClose: () => void; onSelectAddress: (address: string) => void; onSelectTransfer: (id: string) => void};
const suggestions = ["What is USDC?", "Map this network", "Find unusual flows", "Is activity accelerating?", "Concentration"];
const connectionCopy: Record<Connection, string> = {
  live: "Observing verified Arc activity.", stale: "Using the last verified observation window.", connecting: "Connecting to Arc Mainnet...", unavailable: "Verified Arc activity unavailable.",
};

export function IntelligencePanel({snapshot, transfers, selected, connection, expanded, visualizationAvailable, request, onExpand, onClose, onSelectAddress, onSelectTransfer}: Props) {
  const [query, setQuery] = useState("");
  const [pendingQuery, setPendingQuery] = useState("");
  const [answer, setAnswer] = useState<AerisAnswer | null>(null);
  const [history, setHistory] = useState<Exchange[]>([]);
  const [analyzing, setAnalyzing] = useState(false);
  const [agentState, setAgentState] = useState<AgentState>(() => createAgentState());
  const [memoryReady, setMemoryReady] = useState(false);
  const [lastAction, setLastAction] = useState<ProposedAction | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const previousSnapshot = useRef<IntelligenceSnapshot | null>(null);
  const previousTransfers = useRef<Transfer[]>([]);
  const processing = useRef(false);
  const proactiveSnapshot = useRef<number | null>(null);
  const setIntent = useActivity(state => state.setVisualizationIntent);
  const intent = useActivity(state => state.visualizationIntent);
  const health = useActivity(state => state.health);
  const agentStatus = connection === "live" && health.status === "partial" ? "partial" : connection;
  useEffect(() => { setAgentState(loadAgentState()); setMemoryReady(true); }, []);
  useEffect(() => { if (memoryReady) saveAgentState(agentState); }, [agentState, memoryReady]);
  useEffect(() => {
    if (!memoryReady || !snapshot.generatedAt || connection !== "live" || health.status === "partial") return;
    const bucketStart=Math.floor(snapshot.generatedAt/(10*60_000))*(10*60_000);
    setAgentState(current => {
      const existing=current.baseline.buckets.find(item=>item.startedAt===bucketStart);
      if(existing&&existing.transferCount===snapshot.transferCount&&existing.totalVolume===snapshot.totalVolume)return current;
      return recordBaseline(current,{reference:snapshot.generatedAt,transferCount:snapshot.transferCount,totalVolume:snapshot.totalVolume,sub1kCount:transfers.filter(item=>Number(item.value)<1_000).length,largeCount:transfers.filter(item=>Number(item.value)>=100_000).length,uniqueAddresses:snapshot.uniqueAddresses});
    });
  }, [memoryReady, snapshot.generatedAt, snapshot.transferCount, snapshot.totalVolume, snapshot.uniqueAddresses, transfers, connection, health.status]);
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
    timer.current = setTimeout(async () => {
      try {
        const delta = diffSnapshots(previousSnapshot.current, snapshot, previousTransfers.current, transfers);
        let result: AerisAnswer = connection === "connecting" && !transfers.length
          ? {message: "Connecting to Arc Mainnet...", summary: "Connecting to Arc Mainnet...", evidence: [], relatedAddresses: [], relatedTransferIds: [], intent: {type: "reset"} as const, scope: "current-window" as const, trace: makeAgentTrace([], 0, 0)}
          : connection === "unavailable" && !transfers.length
            ? {message: "Verified Arc activity is currently unavailable.", summary: "Verified Arc activity is currently unavailable.", evidence: [], relatedAddresses: [], relatedTransferIds: [], intent: {type: "reset"} as const, scope: "current-window" as const, trace: makeAgentTrace([], 0, 0)}
            : withObservationStatus(answerDeterministically(next, snapshot, transfers, selected, {
                address: history.at(-1)?.answer.relatedAddresses[0] ?? selected,
                previousAddress: history.at(-2)?.answer.relatedAddresses[0] ?? null,
                transferId: history.at(-1)?.answer.relatedTransferIds[0] ?? null,
                delta,
              }), connection);
        const unsupported = result.summary === "I can currently analyze verified activity in the live AERIS observation window.";
        if (unsupported || !transfers.length) {
          const observation = (connection === "live" || connection === "stale") && transfers.length
            ? `Arc Mainnet chain 5042, last 10-minute observation: ${snapshot.transferCount} verified USDC transfers, ${snapshot.totalVolume} USDC, ${snapshot.uniqueAddresses} addresses. Deterministic analysis: ${result.summary}`
            : "Verified Arc activity is unavailable or connecting; do not infer live network facts.";
          try {
            const response = await fetch("/api/agent", {method: "POST", headers: {"Content-Type": "application/json"},
              body: JSON.stringify({query: next, observation, history: history.slice(-6).map(item => ({query: item.query, answer: item.answer.message}))})});
            const payload = await response.json();
            if (!response.ok) throw new Error(payload.error || "AI service unavailable.");
            result = {...result, message: payload.answer, summary: payload.answer, evidence: [], relatedAddresses: [], relatedTransferIds: [], intent: {type: "reset"}, trace: makeAgentTrace([], 0, 0)};
          } catch (error) {
            result = {...result, message: error instanceof Error ? error.message : "AI service unavailable.", summary: error instanceof Error ? error.message : "AI service unavailable.", evidence: [], relatedAddresses: [], relatedTransferIds: [], intent: {type: "reset"}, trace: makeAgentTrace([], 0, 0)};
          }
        }
        setAnswer(result); setHistory(current => [...current, {query: next, answer: result}].slice(-8)); setIntent(result.intent);
        const action = proposeObservationAction(result, snapshot, agentState.policy, 0, new Set(transfers.map(item => item.id)));
        setLastAction(action);
        const now = Date.now();
        const signalSig=sentinelSignature(snapshot)||null;
        const run = createRun({goal:agentState.goal,trigger:"user",triggerReason:next,triggerSignature:null,answer:result,action,snapshot,now});
        setAgentState(current => recordRun(remember(current, {
          id: `memory-${now}-${current.memory.length}`,
          kind: memoryKindFor(action),
          createdAt: now,
          query: next,
          summary: result.summary,
          subject: result.relatedAddresses[0] ?? null,
          relatedTransferIds: result.relatedTransferIds.slice(0, 8),
          evidenceCount: result.evidence.length,
          observationReference: snapshot.generatedAt,
          signalSignature: signalSig, observedVolume: snapshot.totalVolume, transferCount: snapshot.transferCount, counterpartyCount: result.relatedAddresses.length,
        }), run, ledgerEntry(run)));
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

  useEffect(() => {
    if (!memoryReady || processing.current) return;
    const partial = health.status === "partial";
    const decision = shouldTriggerProactively({snapshot,connection,partial,lastRunAt:agentState.lastProactiveRunAt,lastSignature:agentState.lastProactiveSignature,previousGeneratedAt:proactiveSnapshot.current});
    proactiveSnapshot.current = snapshot.generatedAt;
    if (!decision.trigger) return;
    const result = withObservationStatus(answerDeterministically("Find unusual flows", snapshot, transfers, selected), connection);
    const action = proposeObservationAction(result, snapshot, agentState.policy, 0, new Set(transfers.map(item => item.id)));
    const run = createRun({goal:agentState.goal,trigger:"proactive",triggerReason:decision.reason,triggerSignature:decision.signature,answer:result,action,snapshot});
    setLastAction(action); setAnswer(result); setIntent(result.intent);
    setAgentState(current => recordRun(remember(current,{id:`memory-${run.createdAt}-proactive`,kind:memoryKindFor(action),createdAt:run.createdAt,query:"Proactive investigation",summary:result.summary,subject:result.relatedAddresses[0]??null,relatedTransferIds:result.relatedTransferIds.slice(0,8),evidenceCount:result.evidence.length,observationReference:snapshot.generatedAt,signalSignature:decision.signature||null,observedVolume:snapshot.totalVolume,transferCount:snapshot.transferCount,counterpartyCount:result.relatedAddresses.length}),run,ledgerEntry(run)));
  }, [snapshot.generatedAt, memoryReady, connection, health.status]);

  function submit(event: FormEvent) { event.preventDefault(); ask(query); }
  const topFlow = answer?.intent.type === "highlight-transfers" ? snapshot.topFlows.find(flow => answer.intent.type === "highlight-transfers" && answer.intent.transferIds.includes(flow.id)) : null;
  const previousExchanges = analyzing ? history : history.slice(0, -1);
  const context=baselineSummary(agentState,snapshot.generatedAt);
  const currentSignal=sentinelSignature(snapshot)||null;
  const memoryComparison=compareMemory(agentState,{signalSignature:currentSignal,subject:snapshot.signals[0]?.relatedAddresses[0]??null,observedVolume:snapshot.totalVolume,transferCount:snapshot.transferCount,counterpartyCount:snapshot.signals[0]?.relatedAddresses.length??0});
  const baselineRatio=context.dayAverageVolume>0?snapshot.totalVolume/context.dayAverageVolume:null;

  return <section className={`agentModule ${expanded ? "expanded" : "compact"} ${analyzing ? "analyzing" : ""}`} aria-label="AERIS Agent">
    <div className="agentStream" aria-hidden="true">{fragments.map((fragment, index) => <span key={`${fragment}-${index}`} style={{"--row": index, "--speed": `${34 + index % 4 * 7}s`} as CSSProperties}>{fragment}</span>)}</div>
    <div className="agentGlow"/>
    <div className="agentIdentity">
      <Image className="agentPortrait" src="/aeris-agent.png" alt="AERIS Agent" width={90} height={110} priority/>
      <div><div className="agentName">AERIS AGENT <span className={`agentLive ${agentStatus}`}><i/>{agentStatus.toUpperCase()}</span></div><p>Stateful Financial Agent</p><small>OBSERVE · ANALYZE · PLAN · POLICY · ACT · VERIFY · MEMORY</small></div>
      {expanded && <button className="agentClose" onClick={onClose} aria-label="Close AERIS Agent">×</button>}
    </div>
    {expanded && <div className="agentReport">
      <small>{health.status === "partial" ? "◐ PARTIAL · VERIFIED DATA MAY BE INCOMPLETE" : connection === "live" ? "● LIVE · OBSERVING ARC" : connectionCopy[connection].toUpperCase()}</small>
      <div className="agentStateStrip"><span>GOAL · {agentState.goal}</span><span>RUNS · {agentState.runs.length}</span><span>MEMORY · {agentState.memory.length}</span><span>POLICY · {agentState.policy.emergencyStop ? "STOPPED" : agentState.policy.autoExecute ? "AUTONOMOUS" : "APPROVAL-GATED"}</span></div>
      <div className="agentDecision"><label>STATEFUL CONTEXT</label><p>LIVE 10M · {snapshot.transferCount} transfers · {money(String(snapshot.totalVolume))} USDC</p><small className="agentTrace">1H CONTEXT · {context.hourBuckets}/6 VERIFIED BUCKETS · AVG {money(String(context.hourAverageVolume))} USDC / 10M</small><small className="agentTrace">24H BASELINE · {context.dayBuckets}/144 VERIFIED BUCKETS · AVG {money(String(context.dayAverageVolume))} USDC / 10M{baselineRatio!==null?` · CURRENT ${baselineRatio.toFixed(2)}×`:""}</small><small className="agentTrace">MEMORY · {memoryComparison.seenBefore?`SEEN BEFORE · ${memoryComparison.priorObservations} PRIOR OBSERVATION${memoryComparison.priorObservations===1?"":"S"}`:"NEW TO AERIS MEMORY"}{memoryComparison.volumeChangePercent!==null?` · VOLUME ${memoryComparison.volumeChangePercent>=0?"+":""}${memoryComparison.volumeChangePercent.toFixed(1)}%`:""}</small></div>
      {agentState.runs.at(-1) && <div className="agentDecision"><label>COMMAND CENTER · {agentState.runs.at(-1)?.id}</label><p>{agentState.runs.at(-1)?.trigger.toUpperCase()} · {agentState.runs.at(-1)?.status.toUpperCase()} · {agentState.runs.at(-1)?.triggerReason}</p><small className="agentTrace">EVIDENCE · {agentState.runs.at(-1)?.evidence.level.toUpperCase()} · {agentState.runs.at(-1)?.evidence.verifiedEvidence} VERIFIED · {agentState.runs.at(-1)?.evidence.independentSignals} SIGNALS</small><div className="agentLifecycle">{agentState.runs.at(-1)?.tasks.map(task => <span key={task.id} data-status={task.status}>{task.label.replace(" verified Arc activity","").replace(" material signal","").replace(" deterministic policy","").replace(" read-only investigation","").replace(" evidence","").replace(" memory","").toUpperCase()} · {task.status.toUpperCase()}</span>)}</div><div className="agentEvidence"><label>PROOF OF INVESTIGATION</label>{agentState.runs.at(-1)?.proofs.map((proof,index)=><div className="agentEvidenceRow" key={`${proof.kind}-${proof.value}-${index}`}><span>• {proof.label} · {proof.kind==="address"?short(proof.value):proof.value.length>28?short(proof.value):proof.value}</span>{proof.kind==="transaction"?<a href={`${ARC.explorer}/tx/${proof.value}`} target="_blank" rel="noreferrer">VERIFY ↗</a>:proof.kind==="address"?<a href={`${ARC.explorer}/address/${proof.value}`} target="_blank" rel="noreferrer">VERIFY ↗</a>:null}</div>)}</div></div>}
      {lastAction && <div className="agentDecision"><label>DECISION LOOP</label><p>{lastAction.label} · {lastAction.status.toUpperCase()}</p><small className="agentTrace">{lastAction.phases.map(phase => phase.toUpperCase()).join(" → ")}</small><small className="agentTrace">POLICY · {lastAction.policy.reason}</small><small className="agentTrace">VERIFY · {lastAction.verification.message}</small></div>}
      {agentState.memory.length > 0 && <div className="agentHistory"><label>AGENT MEMORY</label>{agentState.memory.slice(-3).reverse().map(item => <div className="pastExchange" key={item.id}><p>{item.kind.toUpperCase()} · {item.subject ? short(item.subject) : "NETWORK"} · {item.evidenceCount} EVIDENCE</p><small className="agentTrace">{item.summary}</small></div>)}</div>}
      {agentState.ledger.length > 0 && <div className="agentHistory"><label>AGENT LEDGER</label>{agentState.ledger.slice(-3).reverse().map(item => <div className="pastExchange" key={item.id}><p>{item.trigger.toUpperCase()} · {item.decision} · {item.status.toUpperCase()}</p><small className="agentTrace">COST {item.costUsdc} USDC · PROOF {item.proof}</small></div>)}</div>}
      <div className="agentHistory">{previousExchanges.map((exchange, index) => <div className="pastExchange" key={`${exchange.query}-${index}`}><label>INVESTIGATION {index + 1} · USER</label><p>{exchange.query}</p><label>AERIS AGENT</label><p>{exchange.answer.message}</p></div>)}</div>
      {(analyzing || history.at(-1)) && <div className="reportQuery"><label>USER</label><p>{analyzing ? pendingQuery : history.at(-1)?.query}</p></div>}
      <div className="reportAnswer"><label>ANALYSIS · {health.status === "partial" ? "PARTIAL VERIFIED OBSERVATION" : connection === "stale" ? "LAST VERIFIED OBSERVATION" : "CURRENT OBSERVATION"} · {snapshot.transferCount.toLocaleString()} VERIFIED TRANSFERS</label><p>{analyzing ? "ANALYZING VERIFIED ACTIVITY..." : answer ? (health.status === "partial" ? `Partial observation: some Arc data may be incomplete. ${answer.summary}` : answer.summary) : connectionCopy[connection]}</p>
        {!analyzing && answer && <><small className="agentTrace">{answer.trace.toolsUsed.length} TOOLS · {answer.trace.entitiesInspected} ENTITIES · {answer.trace.transfersEvaluated} TRANSFERS EVALUATED</small><small className="agentTrace">SUBJECT · {answer.relatedAddresses[0] ? short(answer.relatedAddresses[0]) : "NETWORK"} · EVIDENCE {answer.evidence.length} · ARC MAINNET</small></>}
        {topFlow && !analyzing && <dl><div><dt>AMOUNT</dt><dd>{money(String(topFlow.amount))} USDC</dd></div><div><dt>FROM</dt><dd>{short(topFlow.from)}</dd></div><div><dt>TO</dt><dd>{short(topFlow.to)}</dd></div><div><dt>BLOCK</dt><dd>{topFlow.blockNumber}</dd></div></dl>}
        {!analyzing && answer?.evidence.length ? <div className="agentEvidence"><label>EVIDENCE</label>{answer.evidence.map((item, index) => <div className="agentEvidenceRow" key={`${item.text}-${index}`}><button onMouseEnter={() => item.transferId ? setIntent({type: "highlight-transfers", transferIds: [item.transferId]}) : item.address ? setIntent({type: "highlight-addresses", addresses: [item.address]}) : undefined} onMouseLeave={() => answer && setIntent(answer.intent)} onClick={() => item.transferId ? onSelectTransfer(item.transferId) : item.address ? onSelectAddress(item.address) : undefined}>• {item.text}</button>{item.provenance ? <small className="agentTrace">{item.provenance}</small> : null}{item.txHash ? <a href={`${ARC.explorer}/tx/${item.txHash}`} target="_blank" rel="noreferrer" aria-label="Open transaction in Arcscan">TX ↗</a> : item.address ? <a href={`${ARC.explorer}/address/${item.address}`} target="_blank" rel="noreferrer" aria-label="Open address in Arcscan">ADDRESS ↗</a> : null}</div>)}</div> : null}
        {!analyzing && answer && answer.intent.type !== "reset" && <button className="agentAction" onClick={() => {
          setIntent(answer.intent);
          if (answer.relatedTransferIds[0]) onSelectTransfer(answer.relatedTransferIds[0]);
          else if (answer.relatedAddresses[0]) onSelectAddress(answer.relatedAddresses[0]);
        }}>INSPECT VERIFIED RESULT</button>}
      </div>
    </div>}
    <form className="agentInput" onSubmit={submit}><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Ask AERIS anything..." aria-label="Ask AERIS Agent anything" disabled={analyzing}/><button type="submit" aria-label="Submit question" disabled={!query.trim() || analyzing}>→</button></form>
    <div className="agentCommands">{suggestions.map(item => <button type="button" key={item} disabled={analyzing} onClick={() => ask(item)}>{item}</button>)}</div>
    <div className="agentFoot"><span>{agentStatus === "partial" ? "Verified Arc activity is partially covered." : `${connectionCopy[connection]} · ${agentState.memory.length} persisted memories`}</span>{visualizationAvailable && intent.type !== "reset" && <button onClick={() => setIntent({type: "reset"})}>RESET VIEW</button>}</div>
  </section>;
}
