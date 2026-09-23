import type {ArcActivityEvent, EntityType, Transfer} from "@/data/types";
import type {ActivityCategory, ActivitySlice, AerisSignal, EntityIntelligence, IntelligenceSnapshot, RankedFlow} from "./types";

const TYPES: EntityType[] = ["wallet", "contract", "unknown"];
function amount(value: string) { const parsed = Number(value); return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0; }
function percent(value: number, total: number) { return total > 0 ? (value / total) * 100 : 0; }
function concise(value: number) { return value.toLocaleString("en-US", {maximumFractionDigits: 2}); }
function short(address: string) { return `${address.slice(0, 6)}…${address.slice(-4)}`; }
function flow(transfer: Transfer): RankedFlow { return {id: transfer.id, txHash: transfer.txHash, from: transfer.from, to: transfer.to, amount: amount(transfer.value), blockNumber: transfer.blockNumber, timestamp: transfer.timestamp}; }
function largest(items: RankedFlow[]) { return [...items].sort((a, b) => b.amount - a.amount || a.id.localeCompare(b.id))[0] ?? null; }

export function getEntityIntelligence(snapshot: IntelligenceSnapshot, address: string) {
  return snapshot.entities.find(entity => entity.address.toLowerCase() === address.toLowerCase()) ?? null;
}

export function buildIntelligenceSnapshot(transfers: readonly Transfer[], generatedAt = Date.now(), events: readonly ArcActivityEvent[] = []): IntelligenceSnapshot {
  const rankedFlows = transfers.map(flow).sort((a, b) => b.amount - a.amount || a.id.localeCompare(b.id));
  const totalVolume = rankedFlows.reduce((sum, item) => sum + item.amount, 0);
  type MutableEntity = {address: string; type: EntityType; sent: number; received: number; transferCount: number; counterparties: Set<string>; sentFlows: RankedFlow[]; receivedFlows: RankedFlow[]; relatedTransferIds: string[]};
  const addressMap = new Map<string, MutableEntity>();
  const getAddress = (address: string, type: EntityType) => {
    const key = address.toLowerCase(); const current = addressMap.get(key);
    if (current) { if (current.type === "unknown" && type !== "unknown") current.type = type; return current; }
    const next: MutableEntity = {address, type, sent: 0, received: 0, transferCount: 0, counterparties: new Set(), sentFlows: [], receivedFlows: [], relatedTransferIds: []};
    addressMap.set(key, next); return next;
  };
  const breakdown = new Map<ActivityCategory, {count: number; volume: number}>();
  for (const transfer of transfers) {
    const value = amount(transfer.value); const ranked = flow(transfer);
    const sender = getAddress(transfer.from, transfer.fromType); const receiver = getAddress(transfer.to, transfer.toType);
    sender.sent += value; sender.transferCount++; sender.counterparties.add(transfer.to); sender.sentFlows.push(ranked); sender.relatedTransferIds.push(transfer.id);
    receiver.received += value; receiver.transferCount++; receiver.counterparties.add(transfer.from); receiver.receivedFlows.push(ranked); receiver.relatedTransferIds.push(transfer.id);
    const category: ActivityCategory = `${transfer.fromType}-to-${transfer.toType}`;
    const slice = breakdown.get(category) ?? {count: 0, volume: 0}; slice.count++; slice.volume += value; breakdown.set(category, slice);
  }
  const prelim = [...addressMap.values()].map(item => ({...item, observedVolume: item.sent + item.received}));
  const byCount = [...prelim].sort((a, b) => b.transferCount - a.transferCount || b.observedVolume - a.observedVolume || a.address.localeCompare(b.address));
  const byVolume = [...prelim].sort((a, b) => b.observedVolume - a.observedVolume || b.transferCount - a.transferCount || a.address.localeCompare(b.address));
  const enoughForRank = prelim.length >= 3;
  const entities: EntityIntelligence[] = prelim.map(item => {
    const largestSent = largest(item.sentFlows); const largestReceived = largest(item.receivedFlows); const largestRelated = largest([...item.sentFlows, ...item.receivedFlows]);
    const observedVolumeShare = percent(item.observedVolume, totalVolume * 2);
    const activityRank = enoughForRank ? byCount.findIndex(candidate => candidate.address === item.address) + 1 : null;
    const volumeRank = enoughForRank ? byVolume.findIndex(candidate => candidate.address === item.address) + 1 : null;
    let whyItMatters = "Activity for this address is available, but no dominant pattern stands out in the current observation window.";
    if (rankedFlows[0] && largestRelated?.id === rankedFlows[0].id) whyItMatters = "This entity participated in the largest observed transfer in the current observation window.";
    else if (activityRank === 1 && item.transferCount > 1) whyItMatters = `This ${item.type} is the most active observed entity by transfer count, interacting with ${item.counterparties.size} counterpart${item.counterparties.size === 1 ? "y" : "ies"}.`;
    else if (percent(item.received, totalVolume) >= 20) whyItMatters = `This ${item.type} received ${concise(percent(item.received, totalVolume))}% of observed USDC volume in the current window.`;
    else if (item.sent > item.received * 1.5) whyItMatters = "This address is primarily sending rather than receiving USDC in the current observation window.";
    else if (item.received > item.sent * 1.5) whyItMatters = "This address is primarily receiving rather than sending USDC in the current observation window.";
    return {address: item.address, type: item.type, sent: item.sent, received: item.received, netFlow: item.received - item.sent, observedVolume: item.observedVolume, observedVolumeShare, transferCount: item.transferCount, uniqueCounterparties: item.counterparties.size, activityRank, volumeRank, largestSent, largestReceived, largestRelated, relatedTransferIds: [...new Set(item.relatedTransferIds)], whyItMatters};
  });
  const entityByAddress = new Map(entities.map(item => [item.address.toLowerCase(), item]));
  const rankEntities = (key: "sent" | "received") => [...entities].filter(item => item[key] > 0).sort((a, b) => b[key] - a[key] || a.address.localeCompare(b.address));
  const topSenders = rankEntities("sent"); const topReceivers = rankEntities("received");
  const topContracts = entities.filter(item => item.type === "contract").sort((a, b) => b.transferCount - a.transferCount || b.observedVolume - a.observedVolume || a.address.localeCompare(b.address));
  const mostActiveByCount = byCount.map(item => entityByAddress.get(item.address.toLowerCase())!);
  const mostActiveByVolume = byVolume.map(item => entityByAddress.get(item.address.toLowerCase())!);
  const activityBreakdown: ActivitySlice[] = TYPES.flatMap(from => TYPES.map(to => `${from}-to-${to}` as ActivityCategory)).map(category => {
    const item = breakdown.get(category) ?? {count: 0, volume: 0}; return {...item, category, transferPercent: percent(item.count, transfers.length), volumePercent: percent(item.volume, totalVolume)};
  }).filter(item => item.count > 0);
  const topThreePercent = percent(rankedFlows.slice(0, 3).reduce((sum, item) => sum + item.amount, 0), totalVolume);
  const contractTransfers = transfers.filter(item => item.fromType === "contract" || item.toType === "contract");
  const concentration = {largestTransferPercent: percent(rankedFlows[0]?.amount ?? 0, totalVolume), topThreePercent, topReceiverPercent: percent(topReceivers[0]?.received ?? 0, totalVolume), topSenderPercent: percent(topSenders[0]?.sent ?? 0, totalVolume), contractInteractionPercent: percent(contractTransfers.length, transfers.length)};
  const candidates: AerisSignal[] = [];
  const contractEvents = events.filter(event => event.type === "CONTRACT_CALL");
  const deployments = events.filter(event => event.type === "CONTRACT_DEPLOYMENT");
  const interactionCounts = new Map<string, number>();
  contractEvents.forEach(event => interactionCounts.set(event.to, (interactionCounts.get(event.to) ?? 0) + 1));
  const topInteraction = [...interactionCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
  const networkActivity = {observedEvents: events.length || transfers.length, observedTransactions: events.length ? new Set(events.map(event => event.parentTransactionId)).size : new Set(transfers.map(item => item.txHash)).size, contractInteractions: contractEvents.length, contractDeployments: deployments.length, activeContracts: new Set([...contractEvents.map(event => event.to), ...deployments.map(event => event.deployedContract)]).size, uniqueInteractingAddresses: events.length ? new Set(events.flatMap(event => [event.from, event.to])).size : entities.length, topContractInteractionCount: topInteraction?.[1] ?? 0, interactionConcentrationPercent: percent(topInteraction?.[1] ?? 0, contractEvents.length)};
  const median = rankedFlows.length ? rankedFlows.map(item => item.amount).sort((a, b) => a - b)[Math.floor(rankedFlows.length / 2)] : 0;
  if (rankedFlows.length >= 3 && rankedFlows[0].amount >= median * 2) candidates.push({id: "largest-flow", type: "large-flow", severity: concentration.largestTransferPercent >= 40 ? "notable" : "information", importance: concentration.largestTransferPercent, title: "LARGE FLOW", description: `${concise(rankedFlows[0].amount)} USDC moved between two observed entities; at least twice the median transfer in the current window.`, relatedAddresses: [rankedFlows[0].from, rankedFlows[0].to], relatedTransferIds: [rankedFlows[0].id], evidence: [{label: "Largest transfer", value: rankedFlows[0].amount, unit: "USDC"}, {label: "Share of observed flow", value: concentration.largestTransferPercent, unit: "percent"}], intent: {type: "highlight-transfers", transferIds: [rankedFlows[0].id]}, metric: {label: "Largest transfer", value: rankedFlows[0].amount, unit: "USDC"}});
  if (rankedFlows.length >= 3) candidates.push({id: "flow-concentration", type: "flow-concentration", severity: topThreePercent >= 50 ? "notable" : "information", importance: topThreePercent * .9, title: "FLOW CONCENTRATION", description: `Top 3 transfers account for ${concise(topThreePercent)}% of observed USDC volume.`, relatedAddresses: [...new Set(rankedFlows.slice(0, 3).flatMap(item => [item.from, item.to]))], relatedTransferIds: rankedFlows.slice(0, 3).map(item => item.id), evidence: [{label: "Top 3 share", value: topThreePercent, unit: "percent"}], intent: {type: "highlight-transfers", transferIds: rankedFlows.slice(0, 3).map(item => item.id)}, metric: {label: "Top 3 share", value: topThreePercent, unit: "percent"}});
  const pairs = new Map<string, Transfer[]>();
  for (const transfer of transfers) { const key = `${transfer.from.toLowerCase()}>${transfer.to.toLowerCase()}`; pairs.set(key, [...(pairs.get(key) ?? []), transfer]); }
  const repeated = [...pairs.values()].filter(items => items.length > 1).sort((a, b) => b.length - a.length || a[0].from.localeCompare(b[0].from) || a[0].to.localeCompare(b[0].to))[0];
  if (repeated) candidates.push({id: "repeated-counterparty", type: "repeated-counterparty", severity: "information", importance: Math.min(70, repeated.length * 12), title: "REPEATED COUNTERPARTY", description: `${repeated.length} verified transfers followed the same observed address direction in the current window.`, relatedAddresses: [repeated[0].from, repeated[0].to], relatedTransferIds: repeated.map(item => item.id), evidence: [{label: "Repeated transfers", value: repeated.length, unit: "count"}], intent: {type: "highlight-transfers", transferIds: repeated.map(item => item.id)}, metric: {label: "Repeated transfers", value: repeated.length, unit: "count"}});
  // For short windows, sender/receiver concentration adds information. In larger windows,
  // the top-three signal already explains concentration and avoids semantic repetition.
  if (topReceivers[0] && transfers.length > 1 && rankedFlows.length < 3) candidates.push({id: "top-receiver", type: "receiver-concentration", severity: concentration.topReceiverPercent >= 40 ? "notable" : "information", importance: concentration.topReceiverPercent * .8, title: "TOP RECEIVER", description: `${short(topReceivers[0].address)} received ${concise(concentration.topReceiverPercent)}% of observed USDC volume.`, relatedAddresses: [topReceivers[0].address], relatedTransferIds: topReceivers[0].largestReceived ? [topReceivers[0].largestReceived.id] : [], evidence: [{label: "Received share", value: concentration.topReceiverPercent, unit: "percent"}], intent: {type: "highlight-addresses", addresses: [topReceivers[0].address]}, metric: {label: "Received share", value: concentration.topReceiverPercent, unit: "percent"}});
  if (topSenders[0] && transfers.length > 1 && rankedFlows.length < 3) candidates.push({id: "top-sender", type: "sender-concentration", severity: concentration.topSenderPercent >= 40 ? "notable" : "information", importance: concentration.topSenderPercent * .78, title: "TOP SENDER", description: `${short(topSenders[0].address)} sent ${concise(concentration.topSenderPercent)}% of observed USDC volume.`, relatedAddresses: [topSenders[0].address], relatedTransferIds: topSenders[0].largestSent ? [topSenders[0].largestSent.id] : [], evidence: [{label: "Sent share", value: concentration.topSenderPercent, unit: "percent"}], intent: {type: "highlight-addresses", addresses: [topSenders[0].address]}, metric: {label: "Sent share", value: concentration.topSenderPercent, unit: "percent"}});
  if (topContracts[0]) candidates.push({id: "active-contract", type: "contract-activity", severity: "information", importance: percent(topContracts[0].transferCount, transfers.length) * .65, title: "ACTIVE CONTRACT", description: `${short(topContracts[0].address)} is the most active observed contract with ${topContracts[0].transferCount} transfers.`, relatedAddresses: [topContracts[0].address], relatedTransferIds: topContracts[0].relatedTransferIds, evidence: [{label: "Contract transfers", value: topContracts[0].transferCount, unit: "count"}], intent: {type: "highlight-addresses", addresses: [topContracts[0].address]}, metric: {label: "Contract transfers", value: topContracts[0].transferCount, unit: "count"}});
  if (deployments.length) candidates.push({id: "new-contract-activity", type: "new-contract-activity", severity: "information", importance: Math.min(95, 85 + deployments.length), title: "NEW CONTRACT ACTIVITY", description: `${deployments.length} successful contract deployment${deployments.length === 1 ? " was" : "s were"} observed in the current window.`, relatedAddresses: deployments.map(event => event.deployedContract), relatedTransferIds: [], evidence: [{label: "Deployments", value: deployments.length, unit: "count"}], intent: {type: "highlight-addresses", addresses: deployments.map(event => event.deployedContract)}, metric: {label: "Deployments", value: deployments.length, unit: "count"}});
  const signals = candidates.sort((a, b) => b.importance - a.importance || a.id.localeCompare(b.id)).filter((signal, index, all) => all.findIndex(item => item.type === signal.type) === index).slice(0, 3);
  return {generatedAt, transferCount: transfers.length, totalVolume, uniqueAddresses: entities.length, activeContracts: topContracts.length, largestTransfer: rankedFlows[0] ?? null, topFlows: rankedFlows, topSenders, topReceivers, topContracts, mostActiveByCount, mostActiveByVolume, entities, concentration, activityBreakdown, networkActivity, signals};
}
