import type {Transfer} from "@/data/types";
import type {VisualizationIntent} from "@/intelligence/intents";
import type {IntelligenceSnapshot} from "@/intelligence/types";
import {createIntelligenceTools} from "./tools.ts";

export type AerisAnswer = {message: string; intent: VisualizationIntent; scope: "current-window"};
const format = (value: number) => value.toLocaleString("en-US", {maximumFractionDigits: 2});
export function answerDeterministically(query: string, snapshot: IntelligenceSnapshot, transfers: readonly Transfer[], selectedAddress?: string | null): AerisAnswer {
  const text = query.trim().toLowerCase();
  const tools = createIntelligenceTools(snapshot, transfers);
  if (!snapshot.transferCount) return {message: "No verified activity is available in the current observation window.", intent: {type: "reset"}, scope: "current-window"};
  if (/histor|yesterday|last week|last month/.test(text)) return {message: "Historical indexing is not available yet.", intent: {type: "reset"}, scope: "current-window"};
  if (/reset|clear/.test(text)) return {message: "Showing all verified activity in the current observation window.", intent: {type: "reset"}, scope: "current-window"};
  if (/largest|top transfer|biggest flow/.test(text)) {
    const flows = tools.getLargestFlows(5);
    return {message: `Highlighting ${flows.length} largest observed flow${flows.length === 1 ? "" : "s"}. The largest is ${format(flows[0].amount)} USDC.`, intent: {type: "highlight-transfers", transferIds: flows.map(item => item.id)}, scope: "current-window"};
  }
  if (/active contract|contracts/.test(text)) {
    const contracts = tools.getActiveContracts(8);
    return {message: `${contracts.length} active contract${contracts.length === 1 ? "" : "s"} appear in the current observation window.`, intent: {type: "highlight-addresses", addresses: contracts.map(item => item.address)}, scope: "current-window"};
  }
  if (/top receiver|received the most|receivers/.test(text)) {
    const receivers = tools.getTopReceivers(5);
    return {message: `${receivers[0].address.slice(0, 6)}…${receivers[0].address.slice(-4)} received the most observed USDC: ${format(receivers[0].received)} USDC.`, intent: {type: "highlight-addresses", addresses: receivers.map(item => item.address)}, scope: "current-window"};
  }
  if (/concentrat|where is usdc/.test(text)) return {message: `The top 3 transfers represent ${format(snapshot.concentration.topThreePercent)}% of observed volume; the top receiver accounts for ${format(snapshot.concentration.topReceiverPercent)}%.`, intent: {type: "highlight-transfers", transferIds: snapshot.topFlows.slice(0, 3).map(item => item.id)}, scope: "current-window"};
  if (/wallet.to.contract/.test(text)) return {message: "Highlighting verified wallet-to-contract transfers in the current observation window.", intent: {type: "highlight-transfers", transferIds: transfers.filter(item => item.fromType === "wallet" && item.toType === "contract").map(item => item.id)}, scope: "current-window"};
  const address = text.match(/0x[\da-f]{40}/)?.[0] ?? selectedAddress;
  if (address && (/address|explain|doing|this/.test(text))) {
    const activity = tools.getAddressActivity(address);
    if (!activity) return {message: "This address does not appear in the current AERIS observation window.", intent: {type: "reset"}, scope: "current-window"};
    return {message: `Within the current AERIS observation window, this address appears in ${activity.transferCount} transfers, sending ${format(activity.sent)} USDC and receiving ${format(activity.received)} USDC. It interacted with ${activity.uniqueCounterparties} unique counterparties.`, intent: {type: "focus-address-activity", address}, scope: "current-window"};
  }
  return {message: `${snapshot.transferCount} verified transfers moved ${format(snapshot.totalVolume)} USDC among ${snapshot.uniqueAddresses} addresses in the current observation window.${snapshot.signals[0] ? ` ${snapshot.signals[0].description}` : ""}`, intent: {type: "reset"}, scope: "current-window"};
}
