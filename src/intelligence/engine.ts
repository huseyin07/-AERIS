import type {EntityType, Transfer} from "@/data/types";
import type {ActivityCategory, ActivitySlice, AerisSignal, IntelligenceSnapshot, RankedAddress, RankedFlow} from "./types";

const TYPES: EntityType[] = ["wallet", "contract", "unknown"];

function amount(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}
function percent(value: number, total: number) { return total > 0 ? (value / total) * 100 : 0; }
function concise(value: number) { return value.toLocaleString("en-US", {maximumFractionDigits: 2}); }
function short(address: string) { return `${address.slice(0, 6)}…${address.slice(-4)}`; }
function flow(transfer: Transfer): RankedFlow {
  return {id: transfer.id, txHash: transfer.txHash, from: transfer.from, to: transfer.to, amount: amount(transfer.value), blockNumber: transfer.blockNumber};
}

export function buildIntelligenceSnapshot(transfers: readonly Transfer[], generatedAt = Date.now()): IntelligenceSnapshot {
  const rankedFlows = transfers.map(flow).sort((a, b) => b.amount - a.amount || a.id.localeCompare(b.id));
  const totalVolume = rankedFlows.reduce((sum, item) => sum + item.amount, 0);
  const addresses = new Map<string, RankedAddress & {counterparties: Set<string>}>();
  const getAddress = (address: string, type: EntityType) => {
    const current = addresses.get(address);
    if (current) {
      if (current.type === "unknown" && type !== "unknown") current.type = type;
      return current;
    }
    const next = {address, type, sent: 0, received: 0, transferCount: 0, uniqueCounterparties: 0, counterparties: new Set<string>()};
    addresses.set(address, next);
    return next;
  };
  const breakdown = new Map<ActivityCategory, {count: number; volume: number}>();
  for (const transfer of transfers) {
    const value = amount(transfer.value);
    const sender = getAddress(transfer.from, transfer.fromType);
    const receiver = getAddress(transfer.to, transfer.toType);
    sender.sent += value; sender.transferCount++; sender.counterparties.add(transfer.to);
    receiver.received += value; receiver.transferCount++; receiver.counterparties.add(transfer.from);
    const category: ActivityCategory = `${transfer.fromType}-to-${transfer.toType}`;
    const slice = breakdown.get(category) ?? {count: 0, volume: 0};
    slice.count++; slice.volume += value; breakdown.set(category, slice);
  }
  const ranked = [...addresses.values()].map(({counterparties, ...item}) => ({...item, uniqueCounterparties: counterparties.size}));
  const rank = (key: "sent" | "received") => [...ranked].filter(item => item[key] > 0).sort((a, b) => b[key] - a[key] || a.address.localeCompare(b.address));
  const topSenders = rank("sent");
  const topReceivers = rank("received");
  const topContracts = ranked.filter(item => item.type === "contract").sort((a, b) => b.transferCount - a.transferCount || (b.sent + b.received) - (a.sent + a.received));
  const activityBreakdown: ActivitySlice[] = TYPES.flatMap(from => TYPES.map(to => `${from}-to-${to}` as ActivityCategory)).map(category => {
    const item = breakdown.get(category) ?? {count: 0, volume: 0};
    return {...item, category, transferPercent: percent(item.count, transfers.length), volumePercent: percent(item.volume, totalVolume)};
  }).filter(item => item.count > 0);
  const topThreeVolume = rankedFlows.slice(0, 3).reduce((sum, item) => sum + item.amount, 0);
  const topReceiver = topReceivers[0];
  const concentration = {
    largestTransferPercent: percent(rankedFlows[0]?.amount ?? 0, totalVolume),
    topThreePercent: percent(topThreeVolume, totalVolume),
    topReceiverPercent: percent(topReceiver?.received ?? 0, totalVolume),
  };
  const signals: AerisSignal[] = [];
  if (rankedFlows[0]) signals.push({id: "largest-flow", type: "large-flow", severity: "information", title: "LARGE FLOW", description: `Largest observed transfer: ${concise(rankedFlows[0].amount)} USDC.`, relatedAddresses: [rankedFlows[0].from, rankedFlows[0].to], relatedTransferIds: [rankedFlows[0].id], metric: {value: rankedFlows[0].amount, unit: "USDC"}});
  if (rankedFlows.length >= 3) signals.push({id: "top-three-concentration", type: "flow-concentration", severity: concentration.topThreePercent >= 50 ? "notable" : "information", title: "FLOW CONCENTRATION", description: `Top 3 transfers represent ${concise(concentration.topThreePercent)}% of observed USDC volume.`, relatedAddresses: [...new Set(rankedFlows.slice(0, 3).flatMap(item => [item.from, item.to]))], relatedTransferIds: rankedFlows.slice(0, 3).map(item => item.id), metric: {value: concentration.topThreePercent, unit: "percent"}});
  if (topReceiver) signals.push({id: "top-receiver", type: "receiver-concentration", severity: concentration.topReceiverPercent >= 40 ? "notable" : "information", title: "RECEIVER CONCENTRATION", description: `${short(topReceiver.address)} received ${concise(concentration.topReceiverPercent)}% of observed incoming USDC volume.`, relatedAddresses: [topReceiver.address], relatedTransferIds: transfers.filter(item => item.to === topReceiver.address).map(item => item.id), metric: {value: concentration.topReceiverPercent, unit: "percent"}});
  if (topContracts.length) signals.push({id: "contract-activity", type: "contract-activity", severity: "information", title: "CONTRACT ACTIVITY", description: `${topContracts.length} contract${topContracts.length === 1 ? "" : "s"} interacted with ${new Set(topContracts.flatMap(contract => transfers.filter(item => item.from === contract.address || item.to === contract.address).flatMap(item => [item.from, item.to]).filter(address => address !== contract.address))).size} unique counterparties in the current window.`, relatedAddresses: topContracts.map(item => item.address), relatedTransferIds: transfers.filter(item => item.fromType === "contract" || item.toType === "contract").map(item => item.id), metric: {value: topContracts.length, unit: "count"}});
  const dominant = [...activityBreakdown].sort((a, b) => b.count - a.count)[0];
  if (dominant) signals.push({id: "activity-mix", type: "activity-mix", severity: "information", title: "ACTIVITY MIX", description: `${dominant.category.replaceAll("-", " ")} transfers represent ${concise(dominant.transferPercent)}% of observed transfers.`, relatedAddresses: [], relatedTransferIds: transfers.filter(item => `${item.fromType}-to-${item.toType}` === dominant.category).map(item => item.id), metric: {value: dominant.transferPercent, unit: "percent"}});
  return {generatedAt, transferCount: transfers.length, totalVolume, uniqueAddresses: addresses.size, activeContracts: topContracts.length, largestTransfer: rankedFlows[0] ?? null, topFlows: rankedFlows, topSenders, topReceivers, topContracts, concentration, activityBreakdown, signals};
}
