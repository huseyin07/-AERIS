import type {Transfer} from "@/data/types";
import type {VisualizationIntent} from "@/intelligence/intents";
import type {IntelligenceSnapshot} from "@/intelligence/types";
import {createIntelligenceTools} from "./tools.ts";

export type AnswerEvidence = {text: string; address?: string; transferId?: string};
export type AerisAnswer = {message: string; summary: string; evidence: AnswerEvidence[]; intent: VisualizationIntent; relatedAddresses: string[]; relatedTransferIds: string[]; scope: "current-window"};
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
function answer(summary: string, intent: VisualizationIntent = {type: "reset"}, evidence: AnswerEvidence[] = [], relatedAddresses: string[] = [], relatedTransferIds: string[] = []): AerisAnswer {
  return {message: summary, summary, evidence, intent, relatedAddresses, relatedTransferIds, scope: "current-window"};
}
const unsupported = () => answer("I can currently analyze verified activity in the live AERIS observation window.");

export function answerDeterministically(query: string, snapshot: IntelligenceSnapshot, transfers: readonly Transfer[], selectedAddress?: string | null): AerisAnswer {
  const text = query.trim().toLowerCase().replace(/[’']/g, "'");
  const tools = createIntelligenceTools(snapshot, transfers);
  if (!snapshot.transferCount) return answer("No verified activity is available in the current observation window.");
  if (/histor|yesterday|last\s+(week|month)|\b(24h|7d|30d)\b/.test(text)) return answer("AERIS currently only has access to the live verified observation window. Historical indexing is not available yet.");
  if (/\b(reset|clear)(\s+view)?\b/.test(text)) return answer("Showing all verified activity in the current observation window.");
  const transactionHash = text.match(/0x[\da-f]{64}/)?.[0];
  if (transactionHash) {
    const transfer = transfers.find(item => item.txHash.toLowerCase() === transactionHash);
    if (!transfer) return answer("This transaction is not present in the current verified observation window.");
    const share = snapshot.totalVolume > 0 ? Number(transfer.value) / snapshot.totalVolume * 100 : 0;
    return answer(`${format(Number(transfer.value))} USDC moved from ${short(transfer.from)} to ${short(transfer.to)} in block ${transfer.blockNumber}. This is ${format(share)}% of observed USDC volume; no identity or intent is inferred.`, {type: "highlight-transfers", transferIds: [transfer.id]}, [{text: `${format(Number(transfer.value))} USDC · ${relative(transfer.timestamp, snapshot.generatedAt)}`, transferId: transfer.id}], [transfer.from, transfer.to], [transfer.id]);
  }
  const address = text.match(/0x[\da-f]{40}/)?.[0] ?? (/(address|explain|doing|this|node matter|incoming|outgoing)/.test(text) ? selectedAddress : null);
  if (address) {
    const entity = tools.getEntityIntelligence(address);
    if (!entity) return answer("This address is not present in the current verified observation window.");
    const incoming = /incoming|received/.test(text); const outgoing = /outgoing|sent|sending/.test(text);
    const ids = entity.relatedTransferIds.filter(id => { const item = transfers.find(transfer => transfer.id === id); return item && (!incoming || item.to.toLowerCase() === entity.address.toLowerCase()) && (!outgoing || item.from.toLowerCase() === entity.address.toLowerCase()); });
    const intent: VisualizationIntent = incoming || outgoing ? {type: "highlight-transfers", transferIds: ids} : {type: "focus-address-activity", address: entity.address};
    const summary = incoming ? `Highlighting ${ids.length} observed incoming flow${ids.length === 1 ? "" : "s"} for ${short(entity.address)}.` : outgoing ? `Highlighting ${ids.length} observed outgoing flow${ids.length === 1 ? "" : "s"} for ${short(entity.address)}.` : `Within the current verified observation window, this ${entity.type} appears in ${entity.transferCount} transfers, sending ${format(entity.sent)} USDC and receiving ${format(entity.received)} USDC. It interacted with ${entity.uniqueCounterparties} unique counterparties.${entity.largestRelated ? ` Its largest observed transfer was ${format(entity.largestRelated.amount)} USDC.` : ""} ${entity.whyItMatters}`;
    return answer(summary, intent, [{text: `${entity.transferCount} observed transfers`, address: entity.address}, {text: `${entity.uniqueCounterparties} unique counterparties`, address: entity.address}, ...(entity.largestRelated ? [{text: `${format(entity.largestRelated.amount)} USDC largest related flow`, transferId: entity.largestRelated.id}] : [])], [entity.address], ids);
  }
  if (/(largest|biggest|top)\s+(verified\s+)?(flow|transfer)|largest\s+flows?/.test(text)) {
    const flows = tools.getLargestFlows(3); const ids = flows.map(item => item.id);
    return answer(`Highlighting ${flows.length} largest observed flow${flows.length === 1 ? "" : "s"}. The largest is ${format(flows[0].amount)} USDC.`, {type: "highlight-transfers", transferIds: ids}, flows.map(item => ({text: `${format(item.amount)} USDC · ${short(item.from)} → ${short(item.to)} · ${relative(item.timestamp, snapshot.generatedAt)}`, transferId: item.id})), [...new Set(flows.flatMap(item => [item.from, item.to]))], ids);
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
