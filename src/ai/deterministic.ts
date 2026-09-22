import type {Transfer} from "@/data/types";
import type {VisualizationIntent} from "@/intelligence/intents";
import type {IntelligenceSnapshot} from "@/intelligence/types";
import {createIntelligenceTools} from "./tools.ts";

export type AerisAnswer = {message: string; intent: VisualizationIntent; scope: "current-window"};
const format = (value: number) => value.toLocaleString("en-US", {maximumFractionDigits: 2});
const unsupported = (): AerisAnswer => ({message: "I can currently analyze verified activity in the live AERIS observation window.", intent: {type: "reset"}, scope: "current-window"});

export function answerDeterministically(query: string, snapshot: IntelligenceSnapshot, transfers: readonly Transfer[], selectedAddress?: string | null): AerisAnswer {
  const text = query.trim().toLowerCase().replace(/[’']/g, "'");
  const tools = createIntelligenceTools(snapshot, transfers);
  if (!snapshot.transferCount) return {message: "No verified activity is available in the current observation window.", intent: {type: "reset"}, scope: "current-window"};
  if (/histor|yesterday|last\s+(week|month)|\b(24h|7d|30d)\b/.test(text)) return {message: "AERIS currently only has access to the live verified observation window. Historical indexing is not available yet.", intent: {type: "reset"}, scope: "current-window"};
  if (/\b(reset|clear)(\s+view)?\b/.test(text)) return {message: "Showing all verified activity in the current observation window.", intent: {type: "reset"}, scope: "current-window"};
  const address = text.match(/0x[\da-f]{40}/)?.[0] ?? (/(address|explain|doing|this)/.test(text) ? selectedAddress : null);
  if (address) {
    const activity = tools.getAddressActivity(address);
    if (!activity) return {message: "This address is not present in the current verified observation window.", intent: {type: "reset"}, scope: "current-window"};
    return {message: `Within the current verified observation window, this ${activity.entityType} appears in ${activity.transferCount} transfers, sending ${format(activity.sent)} USDC and receiving ${format(activity.received)} USDC. It interacted with ${activity.uniqueCounterparties} unique counterparties. Its largest observed transfer was ${format(activity.largestTransfer.amount)} USDC.`, intent: {type: "focus-address-activity", address: activity.address}, scope: "current-window"};
  }
  if (/(largest|biggest|top)\s+(verified\s+)?(flow|transfer)|largest\s+flows?/.test(text)) {
    const flows = tools.getLargestFlows(5);
    return {message: `Highlighting ${flows.length} largest observed flow${flows.length === 1 ? "" : "s"}. The largest is ${format(flows[0].amount)} USDC.`, intent: {type: "highlight-transfers", transferIds: flows.map(item => item.id)}, scope: "current-window"};
  }
  if (/(active|top)\s+contracts?|contracts?\s+(are\s+)?active/.test(text)) {
    const contracts = tools.getActiveContracts(8);
    return {message: `${contracts.length} active contract${contracts.length === 1 ? "" : "s"} appear in the current observation window.`, intent: {type: "highlight-addresses", addresses: contracts.map(item => item.address)}, scope: "current-window"};
  }
  if (/top\s+receivers?|receiv(e|ing|ed)\s+(the\s+)?most|who\s+is\s+receiving/.test(text)) {
    const receivers = tools.getTopReceivers(5);
    return {message: `${receivers[0].address.slice(0, 6)}…${receivers[0].address.slice(-4)} received the most observed USDC: ${format(receivers[0].received)} USDC.`, intent: {type: "highlight-addresses", addresses: receivers.map(item => item.address)}, scope: "current-window"};
  }
  if (/concentrat|where\s+is\s+usdc/.test(text)) return {message: `The top 3 transfers represent ${format(snapshot.concentration.topThreePercent)}% of observed volume; the top receiver accounts for ${format(snapshot.concentration.topReceiverPercent)}%.`, intent: {type: "highlight-transfers", transferIds: snapshot.topFlows.slice(0, 3).map(item => item.id)}, scope: "current-window"};
  if (/wallet\s*(to|→|-)\s*contract/.test(text)) return {message: "Highlighting verified wallet-to-contract transfers in the current observation window.", intent: {type: "highlight-transfers", transferIds: transfers.filter(item => item.fromType === "wallet" && item.toType === "contract").map(item => item.id)}, scope: "current-window"};
  if (/(what('s|\s+is)\s+happening|happening\s+(right\s+)?now|summari[sz]e\s+(current\s+)?activity|current\s+activity)/.test(text)) return {message: `${snapshot.transferCount} verified transfers moved ${format(snapshot.totalVolume)} USDC among ${snapshot.uniqueAddresses} addresses in the current observation window.${snapshot.signals[0] ? ` ${snapshot.signals[0].description}` : ""}`, intent: {type: "reset"}, scope: "current-window"};
  return unsupported();
}
