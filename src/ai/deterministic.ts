import type {Transfer} from "@/data/types";
import type {VisualizationIntent} from "@/intelligence/intents";
import type {IntelligenceSnapshot} from "@/intelligence/types";
import {createIntelligenceTools} from "./tools.ts";
import {compareEntities, describeBehavior, makeAgentTrace, planAgentQuery, traceObservedFlow, type AgentTrace, type SnapshotDelta} from "./planner.ts";
import {compareTemporalHalves, concentrationSummary, detectTransferAnomalies, investigateGraph, provenanceFor, verifyAgentEvidence} from "./investigation-engine.ts";

export type AnswerEvidence = {text: string; address?: string; transferId?: string; txHash?: string; blockNumber?: string; provenance?: string};
export type AgentContext = {address?: string | null; transferId?: string | null; previousAddress?: string | null; delta?: SnapshotDelta | null};
export type AerisAnswer = {message: string; summary: string; evidence: AnswerEvidence[]; intent: VisualizationIntent; relatedAddresses: string[]; relatedTransferIds: string[]; scope: "current-window"; trace: AgentTrace};
export function withObservationStatus(result: AerisAnswer, status: "live" | "stale" | "connecting" | "unavailable"): AerisAnswer {
  if (status === "stale") {
    const summary = `Using the last successfully verified observation window. ${result.summary}`;
    return {...result, message: summary, summary};
  }
  if (status === "unavailable") return answer("Verified Arc activity is currently unavailable.");
  if (status === "connecting") return answer("Connecting to Arc Mainnet; no new live analysis is available yet.");
  return result;
}
const format = (value: number) => value.toLocaleString("en-US", {maximumFractionDigits: 2});
const short = (value: string) => `${value.slice(0, 6)}…${value.slice(-4)}`;
const relative = (timestamp: number | undefined, now: number) => { if (!timestamp) return "time unavailable"; const seconds = Math.max(0, Math.floor((now - timestamp) / 1_000)); return seconds < 60 ? `${seconds}s ago` : `${Math.floor(seconds / 60)}m ago`; };
function answer(summary: string, intent: VisualizationIntent = {type: "reset"}, evidence: AnswerEvidence[] = [], relatedAddresses: string[] = [], relatedTransferIds: string[] = [], trace: AgentTrace = makeAgentTrace(["observation"], relatedAddresses.length, relatedTransferIds.length)): AerisAnswer {
  return {message: summary, summary, evidence, intent, relatedAddresses, relatedTransferIds, scope: "current-window", trace};
}
const unsupported = () => answer("I can currently analyze verified activity in the live AERIS observation window.");

export function answerDeterministically(query: string, snapshot: IntelligenceSnapshot, transfers: readonly Transfer[], selectedAddress?: string | null, context: AgentContext = {}): AerisAnswer {
  const text = query.trim().toLowerCase().replace(/[’']/g, "'");
  const tools = createIntelligenceTools(snapshot, transfers);
  const plan = planAgentQuery(query);
  const contextualTransfer = context.transferId ? transfers.find(item => item.id === context.transferId) ?? null : null;
  const contextualAddress = context.address ?? selectedAddress ?? contextualTransfer?.to ?? null;
  if (!snapshot.transferCount) return answer("No verified activity is available in the current observation window.");
  if (/map (the )?network|network around|graph around|isolate (this|the) network|show only (this|the) network/.test(text)) {
    const root = text.match(/0x[\da-f]{40}/)?.[0] ?? contextualAddress;
    if (!root) return answer("Select or provide an observed address before mapping its network.");
    const graph = investigateGraph(transfers, root, 2); const verified = verifyAgentEvidence(transfers, graph.addresses, graph.transferIds);
    return answer(`Mapped the verified 2-hop observation network around ${short(root)}: ${verified.verifiedAddresses.length} addresses and ${verified.verifiedTransferIds.length} transfers. Direct structure: ${graph.fanIn} unique incoming counterparties and ${graph.fanOut} unique outgoing counterparties. This describes only the current observation window.`, {type:"isolate-network", addresses:verified.verifiedAddresses, transferIds:verified.verifiedTransferIds}, [{text:`${graph.fanIn} fan-in · ${graph.fanOut} fan-out`,address:root}], verified.verifiedAddresses, verified.verifiedTransferIds, makeAgentTrace(["graph-investigation","evidence-verifier"],verified.verifiedAddresses.length,transfers.length));
  }
  if (/anomal|unusual|outlier|why .*flag/.test(text)) {
    const findings=detectTransferAnomalies(transfers,snapshot.totalVolume); if(!findings.length) return answer("No transfer crosses AERIS's deterministic unusual-activity thresholds in the current observation window.");
    const ids=findings.map(item=>item.transferId); const verified=verifyAgentEvidence(transfers,[],ids); const first=findings[0];
    return answer(`AERIS found ${findings.length} statistically unusual observed transfer${findings.length===1?"":"s"}. Strongest finding: ${first.reason}. “Unusual” is a distribution comparison inside this window, not a claim of suspicious intent.`, {type:"highlight-transfers",transferIds:verified.verifiedTransferIds}, findings.slice(0,5).map(item=>{const transfer=transfers.find(t=>t.id===item.transferId)!; return {text:item.reason,transferId:transfer.id,txHash:transfer.txHash,blockNumber:transfer.blockNumber,provenance:`Arc Mainnet → block ${transfer.blockNumber} → tx ${short(transfer.txHash)} → log ${transfer.logIndex} → normalized event`};}), [], verified.verifiedTransferIds, makeAgentTrace(["anomaly-detection","evidence-verifier","provenance"],0,transfers.length));
  }
  if (/accelerat|tempo|momentum|recent half|previous half/.test(text)) {
    const temporal=compareTemporalHalves(transfers); if(!temporal) return answer("There is not enough timestamped verified activity to compare equal observed intervals.");
    const show=(value:number|null)=>value===null?"not comparable":`${value>=0?"+":""}${format(value)}%`;
    return answer(`Within the timestamp span currently observed, the newer half has ${temporal.currentCount} transfers versus ${temporal.previousCount} in the older half (${show(temporal.countChangePercent)}), while observed volume changed from ${format(temporal.previousVolume)} to ${format(temporal.currentVolume)} USDC (${show(temporal.volumeChangePercent)}). This is an in-window comparison, not long-term history.`, {type:"reset"}, [{text:`Transfer frequency change · ${show(temporal.countChangePercent)}`},{text:`Observed volume change · ${show(temporal.volumeChangePercent)}`}], [], [], makeAgentTrace(["temporal-analysis"],0,transfers.length));
  }
  if (/concentration|concentrated|top three|top 3/.test(text)) {
    const concentration=concentrationSummary(snapshot);
    return answer(`Observed concentration: largest transfer ${format(concentration.largestFlowPercent)}% of volume; top three flows ${format(concentration.topThreePercent)}%; top sender ${format(concentration.topSenderPercent)}%; top receiver ${format(concentration.topReceiverPercent)}%.`, {type:"highlight-transfers",transferIds:snapshot.topFlows.slice(0,3).map(item=>item.id)}, [{text:`Top three flows · ${format(concentration.topThreePercent)}% of observed volume`}], [], snapshot.topFlows.slice(0,3).map(item=>item.id), makeAgentTrace(["concentration-analysis"],0,transfers.length));
  }
  const minimumMatch=text.match(/(?:above|over|greater than)\s*\$?([\d,.]+)\s*(k|m)?/i);
  if (minimumMatch && /(show|hide|flow|transfer)/.test(text)) {
    const multiplier=minimumMatch[2]?.toLowerCase()==="m"?1_000_000:minimumMatch[2]?.toLowerCase()==="k"?1_000:1; const minimum=Number(minimumMatch[1].replace(/,/g,""))*multiplier;
    const ids=transfers.filter(item=>Number(item.value)>=minimum).map(item=>item.id);
    return answer(`Showing ${ids.length} verified transfer${ids.length===1?"":"s"} at or above ${format(minimum)} USDC.`, {type:"filter-transfers",minimumAmount:minimum}, ids.slice(0,5).map(id=>{const item=transfers.find(t=>t.id===id)!;return {text:`${format(Number(item.value))} USDC`,transferId:id,txHash:item.txHash,blockNumber:item.blockNumber};}), [], ids, makeAgentTrace(["visualization-filter"],0,transfers.length));
  }
  if (plan.intent === "changes") {
    const delta = context.delta;
    if (!delta) return answer("AERIS needs a previous verified snapshot before it can describe what changed.");
    const direction = (value: number) => value > 0 ? `+${format(value)}` : format(value);
    const ids = delta.newTransferIds.slice(0, 20);
    return answer(`Since the previous verified snapshot: transfers ${direction(delta.transferCount)}, observed USDC volume ${direction(delta.volume)}, and unique addresses ${direction(delta.uniqueAddresses)}. ${delta.newTransferIds.length} newly observed transfers and ${delta.newAddresses.length} newly observed addresses entered the rolling window. Window expiry can also reduce these metrics.`, ids.length ? {type: "highlight-transfers", transferIds: ids} : {type: "reset"}, [{text: `${delta.newTransferIds.length} newly observed transfers`}, {text: `${delta.newAddresses.length} newly observed addresses`}], delta.newAddresses.slice(0, 10), ids, makeAgentTrace(["snapshot-diff", "signals"], delta.newAddresses.length, transfers.length));
  }
  if (plan.intent === "compare") {
    const addresses = plan.addresses.length >= 2 ? plan.addresses : [context.previousAddress, context.address].filter((value): value is string => Boolean(value));
    if (addresses.length < 2) return answer("Give me two observed addresses to compare, or analyze them one after another first.");
    const comparison = compareEntities(snapshot, addresses[0], addresses[1]);
    if (!comparison) return answer("Both addresses must be present in the current verified observation window.");
    const aBehavior = describeBehavior(comparison.a).join(", "); const bBehavior = describeBehavior(comparison.b).join(", ");
    return answer(`${short(comparison.a.address)}: ${comparison.a.transferCount} transfers, ${format(comparison.a.sent)} sent, ${format(comparison.a.received)} received, net ${format(comparison.a.netFlow)} USDC (${aBehavior}). ${short(comparison.b.address)}: ${comparison.b.transferCount} transfers, ${format(comparison.b.sent)} sent, ${format(comparison.b.received)} received, net ${format(comparison.b.netFlow)} USDC (${bBehavior}).`, {type: "highlight-addresses", addresses: [comparison.a.address, comparison.b.address]}, [{text: `${short(comparison.a.address)} · ${comparison.a.uniqueCounterparties} counterparties`, address: comparison.a.address}, {text: `${short(comparison.b.address)} · ${comparison.b.uniqueCounterparties} counterparties`, address: comparison.b.address}], [comparison.a.address, comparison.b.address], comparison.sharedTransferIds, makeAgentTrace(["entity-intelligence", "entity-comparison", "behavior-fingerprint"], 2, comparison.a.relatedTransferIds.length + comparison.b.relatedTransferIds.length));
  }
  if (plan.intent === "investigate" && /(something interesting|figure it out|deep dive)/.test(text)) {
    const signals = tools.getCurrentSignals(); const flow = tools.getLargestFlows(1)[0]; const active = snapshot.mostActiveByCount[0];
    const ids = [...new Set([...(flow ? [flow.id] : []), ...signals.flatMap(item => item.relatedTransferIds)])].slice(0, 12);
    const addresses = [...new Set([...(flow ? [flow.from, flow.to] : []), ...(active ? [active.address] : []), ...signals.flatMap(item => item.relatedAddresses)])].slice(0, 12);
    const signalCopy = signals[0]?.description ?? "No deterministic signal exceeds the current signal rules.";
    const flowCopy = flow ? ` Largest observed flow is ${format(flow.amount)} USDC from ${short(flow.from)} to ${short(flow.to)}.` : "";
    const activeCopy = active ? ` Most active observed entity is ${short(active.address)} with ${active.transferCount} transfers (${describeBehavior(active).join(", ")}).` : "";
    return answer(`AERIS investigated the current verified window. ${signalCopy}${flowCopy}${activeCopy} These are observation-window patterns only; no identity or intent is inferred.`, ids.length ? {type: "highlight-transfers", transferIds: ids} : {type: "highlight-addresses", addresses}, [{text: `${format(snapshot.totalVolume)} USDC across ${snapshot.transferCount} transfers`}, ...(flow ? [{text: `${format(flow.amount)} USDC largest flow`, transferId: flow.id, txHash: flow.txHash, blockNumber: flow.blockNumber}] : []), ...(active ? [{text: `${active.transferCount} transfers · most active`, address: active.address}] : [])], addresses, ids, makeAgentTrace(["network-summary", "signals", "largest-flow", "patterns", "entity-intelligence", "behavior-fingerprint"], addresses.length, transfers.length));
  }
  if (plan.intent === "trace") {
    const start = contextualTransfer ?? (contextualAddress ? transfers.filter(item => item.from.toLowerCase() === contextualAddress.toLowerCase() || item.to.toLowerCase() === contextualAddress.toLowerCase()).sort((a,b) => Number(b.value) - Number(a.value))[0] : tools.getLargestFlows(1)[0] ? transfers.find(item => item.id === tools.getLargestFlows(1)[0].id) : null);
    if (!start) return answer("No verified transfer is available to trace in the current observation window.");
    const traced = traceObservedFlow(transfers, start.id);
    if (!traced) return answer("The selected transfer could not be traced in the current observation window.");
    return answer(`Observed-window trace found ${traced.hops} linked transfer${traced.hops === 1 ? "" : "s"} across ${traced.addresses.length} addresses. This is only a path visible inside AERIS's rolling observation window, not a claim about ultimate fund origin or destination.`, {type: "highlight-transfers", transferIds: traced.transferIds}, traced.transferIds.slice(0, 5).map(id => { const item = transfers.find(transfer => transfer.id === id)!; return {text: `${format(Number(item.value))} USDC · ${short(item.from)} → ${short(item.to)}`, transferId: item.id, txHash: item.txHash, blockNumber: item.blockNumber}; }), traced.addresses, traced.transferIds, makeAgentTrace(["transfer-details", "flow-trace"], traced.addresses.length, transfers.length));
  }
  if (/histor|yesterday|last\s+(week|month)|\b(24h|7d|30d)\b/.test(text)) return answer("AERIS currently only has access to the live verified observation window. Historical indexing is not available yet.");
  if (/\b(reset|clear|go back)(\s+view|\s+investigation)?\b/.test(text)) return answer("Showing all verified activity in the current observation window.", {type:"reset"});
  if (/(investigate|trace|analy[sz]e)\s+(the\s+)?(largest|biggest|top)\s+(flow|transfer)/.test(text)) {
    const flow = tools.getLargestFlows(1)[0];
    if (!flow) return answer("No verified transfer is available to investigate in the current observation window.");
    const sender = tools.getEntityIntelligence(flow.from); const receiver = tools.getEntityIntelligence(flow.to);
    const share = snapshot.totalVolume > 0 ? flow.amount / snapshot.totalVolume * 100 : 0;
    const summary = `Investigation: ${format(flow.amount)} USDC moved from ${short(flow.from)} to ${short(flow.to)} in block ${flow.blockNumber}, representing ${format(share)}% of observed USDC volume. In this window, the sender has ${sender?.transferCount ?? 0} transfers and net flow ${format(sender?.netFlow ?? 0)} USDC; the receiver has ${receiver?.transferCount ?? 0} transfers and net flow ${format(receiver?.netFlow ?? 0)} USDC. These are observed flow statistics, not identity or intent claims.`;
    return answer(summary, {type: "highlight-transfers", transferIds: [flow.id]}, [
      {text: `${format(flow.amount)} USDC investigated flow`, transferId: flow.id, txHash: flow.txHash, blockNumber: flow.blockNumber},
      {text: `Sender · ${sender?.transferCount ?? 0} transfers · net ${format(sender?.netFlow ?? 0)} USDC`, address: flow.from},
      {text: `Receiver · ${receiver?.transferCount ?? 0} transfers · net ${format(receiver?.netFlow ?? 0)} USDC`, address: flow.to},
    ], [flow.from, flow.to], [flow.id]);
  }
  if (/(investigate|analy[sz]e|explain)\s+(this|it|that)(\s+(flow|transfer))?/.test(text) && contextualTransfer) {
    const share = snapshot.totalVolume > 0 ? Number(contextualTransfer.value) / snapshot.totalVolume * 100 : 0;
    return answer(`This observed transfer moved ${format(Number(contextualTransfer.value))} USDC from ${short(contextualTransfer.from)} to ${short(contextualTransfer.to)} in block ${contextualTransfer.blockNumber}, representing ${format(share)}% of observed volume.`, {type: "highlight-transfers", transferIds: [contextualTransfer.id]}, [{text: `${format(Number(contextualTransfer.value))} USDC`, transferId: contextualTransfer.id, txHash: contextualTransfer.txHash, blockNumber: contextualTransfer.blockNumber}], [contextualTransfer.from, contextualTransfer.to], [contextualTransfer.id]);
  }
  const transactionHash = text.match(/0x[\da-f]{64}/)?.[0];
  if (transactionHash) {
    const transfer = transfers.find(item => item.txHash.toLowerCase() === transactionHash);
    if (!transfer) return answer("This transaction is not present in the current verified observation window.");
    const share = snapshot.totalVolume > 0 ? Number(transfer.value) / snapshot.totalVolume * 100 : 0;
    return answer(`${format(Number(transfer.value))} USDC moved from ${short(transfer.from)} to ${short(transfer.to)} in block ${transfer.blockNumber}. This is ${format(share)}% of observed USDC volume; no identity or intent is inferred.`, {type: "highlight-transfers", transferIds: [transfer.id]}, [{text: `${format(Number(transfer.value))} USDC · ${relative(transfer.timestamp, snapshot.generatedAt)}`, transferId: transfer.id, txHash: transfer.txHash, blockNumber: transfer.blockNumber}], [transfer.from, transfer.to], [transfer.id]);
  }
  const address = text.match(/0x[\da-f]{40}/)?.[0] ?? (/(address|explain|doing|this|it|its|that|node matter|incoming|outgoing|received|sent|counterpart)/.test(text) ? contextualAddress : null);
  if (address) {
    const entity = tools.getEntityIntelligence(address);
    if (!entity) return answer("This address is not present in the current verified observation window.");
    if (/counterpart/.test(text)) {
      const related = transfers.filter(item => item.from.toLowerCase() === entity.address.toLowerCase() || item.to.toLowerCase() === entity.address.toLowerCase());
      const counts = new Map<string, {count: number; volume: number}>();
      for (const item of related) { const peer = item.from.toLowerCase() === entity.address.toLowerCase() ? item.to : item.from; const current = counts.get(peer) ?? {count: 0, volume: 0}; current.count += 1; current.volume += Number(item.value); counts.set(peer, current); }
      const peers = [...counts.entries()].sort((a, b) => b[1].count - a[1].count || b[1].volume - a[1].volume || a[0].localeCompare(b[0])).slice(0, 5);
      const addresses = peers.map(([peer]) => peer);
      return answer(`${short(entity.address)} interacted with ${entity.uniqueCounterparties} unique counterparties; ${peers.length ? `${short(peers[0][0])} is the most frequent observed counterparty with ${peers[0][1].count} transfers.` : "none are available to rank."}`, {type: "highlight-addresses", addresses: [entity.address, ...addresses]}, peers.map(([peer, stats]) => ({text: `${short(peer)} · ${stats.count} transfers · ${format(stats.volume)} USDC`, address: peer})), [entity.address, ...addresses], entity.relatedTransferIds);
    }
    const incoming = /incoming|received|receive/.test(text); const outgoing = /outgoing|sent|sending|send/.test(text);
    const ids = entity.relatedTransferIds.filter(id => { const item = transfers.find(transfer => transfer.id === id); return item && (!incoming || item.to.toLowerCase() === entity.address.toLowerCase()) && (!outgoing || item.from.toLowerCase() === entity.address.toLowerCase()); });
    const intent: VisualizationIntent = incoming || outgoing ? {type: "highlight-transfers", transferIds: ids} : {type: "focus-address-activity", address: entity.address};
    const summary = incoming ? `Highlighting ${ids.length} observed incoming flow${ids.length === 1 ? "" : "s"} for ${short(entity.address)}.` : outgoing ? `Highlighting ${ids.length} observed outgoing flow${ids.length === 1 ? "" : "s"} for ${short(entity.address)}.` : `Within the current verified observation window, this ${entity.type} appears in ${entity.transferCount} transfers, sending ${format(entity.sent)} USDC and receiving ${format(entity.received)} USDC. It interacted with ${entity.uniqueCounterparties} unique counterparties.${entity.largestRelated ? ` Its largest observed transfer was ${format(entity.largestRelated.amount)} USDC.` : ""} ${entity.whyItMatters}`;
    return answer(summary, intent, [{text: `${entity.transferCount} observed transfers`, address: entity.address}, {text: `${entity.uniqueCounterparties} unique counterparties`, address: entity.address}, ...(entity.largestRelated ? [{text: `${format(entity.largestRelated.amount)} USDC largest related flow`, transferId: entity.largestRelated.id}] : [])], [entity.address], ids);
  }
  if (/(largest|biggest|top)\s+(verified\s+)?(flow|transfer)|largest\s+flows?/.test(text)) {
    const flows = tools.getLargestFlows(3); const ids = flows.map(item => item.id);
    return answer(`Highlighting ${flows.length} largest observed flow${flows.length === 1 ? "" : "s"}. The largest is ${format(flows[0].amount)} USDC.`, {type: "highlight-transfers", transferIds: ids}, flows.map(item => ({text: `${format(item.amount)} USDC · ${short(item.from)} → ${short(item.to)} · ${relative(item.timestamp, snapshot.generatedAt)}`, transferId: item.id, txHash: item.txHash, blockNumber: item.blockNumber})), [...new Set(flows.flatMap(item => [item.from, item.to]))], ids);
  }
  if (/(active|top)\s+contracts?|contracts?\s+(are\s+)?active/.test(text)) {
    const contracts = tools.getActiveContracts(5); const addresses = contracts.map(item => item.address);
    return answer(`${contracts.length} active contract${contracts.length === 1 ? "" : "s"} appear in the current observation window.`, {type: "highlight-addresses", addresses}, contracts.map(item => ({text: `${short(item.address)} · ${item.transferCount} transfers`, address: item.address})), addresses, []);
  }
  if (/contract\s+activity|contract\s+flows?/.test(text)) {
    const ids = transfers.filter(item => item.fromType === "contract" || item.toType === "contract").map(item => item.id);
    return answer(`Highlighting ${ids.length} verified contract-related transfer${ids.length === 1 ? "" : "s"}.`, {type: "highlight-transfers", transferIds: ids}, [{text: `${format(snapshot.concentration.contractInteractionPercent)}% of transfers involve contracts`}], snapshot.topContracts.map(item => item.address), ids);
  }
  if (/top\s+receivers?|receiv(e|ing|ed)\s+(the\s+)?most|who\s+is\s+receiving/.test(text)) {
    const entities = tools.getTopReceivers(5); const addresses = entities.map(item => item.address);
    return answer(`${short(entities[0].address)} received the most observed USDC: ${format(entities[0].received)} USDC.`, {type: "highlight-addresses", addresses}, entities.map(item => ({text: `${short(item.address)} · ${format(item.received)} USDC received`, address: item.address})), addresses, []);
  }
  if (/top\s+senders?|send(ing|s|er)?\s+(the\s+)?most|who\s+is\s+sending/.test(text)) {
    const entities = tools.getTopSenders(5); const addresses = entities.map(item => item.address);
    return answer(`${short(entities[0].address)} sent the most observed USDC: ${format(entities[0].sent)} USDC.`, {type: "highlight-addresses", addresses}, entities.map(item => ({text: `${short(item.address)} · ${format(item.sent)} USDC sent`, address: item.address})), addresses, []);
  }
  if (/(most active|busiest|highest activity)(\s+(address|entity|wallet))?|who\s+is\s+most\s+active/.test(text)) {
    const entity = snapshot.mostActiveByCount[0];
    if (!entity) return answer("No verified entity activity is available in the current observation window.");
    return answer(`${short(entity.address)} is the most active observed entity with ${entity.transferCount} transfers and ${entity.uniqueCounterparties} unique counterparties.`, {type: "highlight-addresses", addresses: [entity.address]}, [{text: `${entity.transferCount} transfers · ${entity.uniqueCounterparties} counterparties`, address: entity.address}], [entity.address], entity.relatedTransferIds);
  }
  if (/(largest|biggest|highest)\s+(net\s+)?(inflow|receiver)|(net\s+)?inflow/.test(text)) {
    const entity = snapshot.entities.slice().sort((a, b) => b.netFlow - a.netFlow || a.address.localeCompare(b.address))[0];
    if (!entity) return answer("No verified entity activity is available in the current observation window.");
    return answer(`${short(entity.address)} has the largest observed net inflow: ${format(entity.netFlow)} USDC.`, {type: "highlight-addresses", addresses: [entity.address]}, [{text: `${format(entity.received)} received · ${format(entity.sent)} sent`, address: entity.address}], [entity.address], entity.relatedTransferIds);
  }
  if (/(largest|biggest|highest)\s+(net\s+)?(outflow|sender)|(net\s+)?outflow/.test(text)) {
    const entity = snapshot.entities.slice().sort((a, b) => a.netFlow - b.netFlow || a.address.localeCompare(b.address))[0];
    if (!entity) return answer("No verified entity activity is available in the current observation window.");
    return answer(`${short(entity.address)} has the largest observed net outflow: ${format(Math.abs(entity.netFlow))} USDC.`, {type: "highlight-addresses", addresses: [entity.address]}, [{text: `${format(entity.sent)} sent · ${format(entity.received)} received`, address: entity.address}], [entity.address], entity.relatedTransferIds);
  }
  if (/(latest|newest|most recent)\s+(transfer|flow)|last\s+transfer/.test(text)) {
    const transfer = transfers.slice().sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0) || Number(BigInt(b.blockNumber) - BigInt(a.blockNumber)) || (b.transactionIndex ?? 0) - (a.transactionIndex ?? 0) || b.logIndex - a.logIndex)[0];
    if (!transfer) return answer("No verified transfer is available in the current observation window.");
    return answer(`The latest observed transfer is ${format(Number(transfer.value))} USDC from ${short(transfer.from)} to ${short(transfer.to)} in block ${transfer.blockNumber}.`, {type: "highlight-transfers", transferIds: [transfer.id]}, [{text: `${format(Number(transfer.value))} USDC · ${relative(transfer.timestamp, snapshot.generatedAt)}`, transferId: transfer.id, txHash: transfer.txHash, blockNumber: transfer.blockNumber}], [transfer.from, transfer.to], [transfer.id]);
  }
  if (/(pattern|repeated|repeat flow|recurring)/.test(text)) {
    const pairs = new Map<string, {count: number; volume: number; ids: string[]; from: string; to: string}>();
    for (const item of transfers) { const key = `${item.from.toLowerCase()}->${item.to.toLowerCase()}`; const current = pairs.get(key) ?? {count: 0, volume: 0, ids: [], from: item.from, to: item.to}; current.count += 1; current.volume += Number(item.value); current.ids.push(item.id); pairs.set(key, current); }
    const repeated = [...pairs.values()].filter(item => item.count > 1).sort((a, b) => b.count - a.count || b.volume - a.volume).slice(0, 3);
    if (!repeated.length) return answer("No repeated directed transfer pattern appears in the current verified observation window.");
    const ids = repeated.flatMap(item => item.ids);
    return answer(`${repeated.length} repeated directed flow pattern${repeated.length === 1 ? "" : "s"} stand out. The leading pair repeated ${repeated[0].count} times for ${format(repeated[0].volume)} USDC in observed volume.`, {type: "highlight-transfers", transferIds: ids}, repeated.map(item => ({text: `${short(item.from)} → ${short(item.to)} · ${item.count} transfers · ${format(item.volume)} USDC`, transferId: item.ids[0]})), [...new Set(repeated.flatMap(item => [item.from, item.to]))], ids);
  }
  if (/(signals?|notable|unusual|interesting|stand\s*out)/.test(text)) {
    const signals = tools.getCurrentSignals();
    if (!signals.length) return answer("No deterministic AERIS signal stands out in the current verified observation window.");
    const primary = signals[0];
    return answer(`${signals.length} deterministic signal${signals.length === 1 ? "" : "s"} currently stand out. ${primary.description}`, primary.intent, signals.map(signal => ({text: `${signal.title} · ${signal.description}`, transferId: signal.relatedTransferIds[0], address: signal.relatedAddresses[0]})), [...new Set(signals.flatMap(signal => signal.relatedAddresses))], [...new Set(signals.flatMap(signal => signal.relatedTransferIds))]);
  }
  if (/counterpart/.test(text)) {
    const entity = snapshot.entities.slice().sort((a, b) => b.uniqueCounterparties - a.uniqueCounterparties || a.address.localeCompare(b.address))[0];
    return answer(`${short(entity.address)} has the most observed counterparties: ${entity.uniqueCounterparties}.`, {type: "highlight-addresses", addresses: [entity.address]}, [{text: `${entity.uniqueCounterparties} unique counterparties`, address: entity.address}], [entity.address], []);
  }
  if (/concentrat|where\s+is\s+usdc/.test(text)) {
    const ids = snapshot.topFlows.slice(0, 3).map(item => item.id); const receiver = snapshot.topReceivers[0];
    return answer(`The top 3 transfers represent ${format(snapshot.concentration.topThreePercent)}% of observed volume; the top receiver accounts for ${format(snapshot.concentration.topReceiverPercent)}%.`, {type: "highlight-transfers", transferIds: ids}, [{text: `Top 3 flows · ${format(snapshot.concentration.topThreePercent)}%`, transferId: ids[0]}, ...(receiver ? [{text: `${short(receiver.address)} · top receiver`, address: receiver.address}] : [])], receiver ? [receiver.address] : [], ids);
  }
  if (/wallet\s*(to|→|-)\s*contract/.test(text)) { const ids = transfers.filter(item => item.fromType === "wallet" && item.toType === "contract").map(item => item.id); return answer("Highlighting verified wallet-to-contract transfers in the current observation window.", {type: "highlight-transfers", transferIds: ids}, [], [], ids); }
  if (/(what('s|\s+is)\s+happening|happening\s+(right\s+)?now|summari[sz]e\s+(current\s+)?activity|current\s+activity)/.test(text)) {
    const summary = `${snapshot.networkActivity.observedEvents} verified activities include ${snapshot.transferCount} USDC transfers moving ${format(snapshot.totalVolume)} USDC among ${snapshot.uniqueAddresses} addresses, with ${snapshot.networkActivity.contractInteractions} contract interactions in the current observation window.`;
    const primary = snapshot.signals[0];
    return answer(`${summary}${primary ? ` ${primary.description}` : ""}`, primary?.intent ?? {type: "reset"}, [{text: `${format(snapshot.totalVolume)} USDC observed`}, {text: `${snapshot.uniqueAddresses} active addresses`}, ...(primary ? [{text: primary.description, transferId: primary.relatedTransferIds[0], address: primary.relatedAddresses[0]}] : [])], primary?.relatedAddresses ?? [], primary?.relatedTransferIds ?? []);
  }
  return unsupported();
}
