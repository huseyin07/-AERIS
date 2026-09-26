import type {Transfer} from "@/data/types";
import type {IntelligenceSnapshot, EntityIntelligence} from "@/intelligence/types";

export type AgentPlanStep = "network-summary" | "signals" | "largest-flow" | "entity" | "compare-entities" | "trace-flow" | "patterns" | "changes";
export type AgentPlan = {intent: "investigate" | "compare" | "trace" | "changes" | "analyze"; steps: AgentPlanStep[]; addresses: string[]};
export type AgentTrace = {toolsUsed: string[]; entitiesInspected: number; transfersEvaluated: number};
export type FlowTrace = {addresses: string[]; transferIds: string[]; hops: number};
export type SnapshotDelta = {transferCount: number; volume: number; uniqueAddresses: number; newTransferIds: string[]; newAddresses: string[]};

const addressPattern = /0x[\da-f]{40}/gi;

export function planAgentQuery(query: string): AgentPlan {
  const text = query.toLowerCase();
  const addresses = [...new Set(query.match(addressPattern) ?? [])];
  if (/what changed|changes?|since (then|last)|new since/.test(text)) return {intent: "changes", steps: ["changes", "signals"], addresses};
  if (/compare|versus|\bvs\b/.test(text)) return {intent: "compare", steps: ["compare-entities"], addresses};
  if (/trace|follow (the )?(flow|money)|where did .* go/.test(text)) return {intent: "trace", steps: ["trace-flow", "entity"], addresses};
  if (/something interesting|figure it out|investigate|deep dive/.test(text)) return {intent: "investigate", steps: ["network-summary", "signals", "largest-flow", "patterns", "entity"], addresses};
  return {intent: "analyze", steps: ["network-summary"], addresses};
}

export function compareEntities(snapshot: IntelligenceSnapshot, first: string, second: string) {
  const byAddress = (value: string) => snapshot.entities.find(item => item.address.toLowerCase() === value.toLowerCase()) ?? null;
  const a = byAddress(first); const b = byAddress(second);
  if (!a || !b) return null;
  const counterparties = (entity: EntityIntelligence) => new Set(entity.relatedTransferIds);
  const left = counterparties(a); const right = counterparties(b);
  return {a, b, sharedTransferIds: [...left].filter(id => right.has(id))};
}

export function traceObservedFlow(transfers: readonly Transfer[], startTransferId: string, maxHops = 4): FlowTrace | null {
  const start = transfers.find(item => item.id === startTransferId);
  if (!start) return null;
  const ids = [start.id]; const addresses = [start.from, start.to]; let cursor = start.to; let block = BigInt(start.blockNumber);
  for (let hop = 1; hop < Math.max(1, Math.min(maxHops, 6)); hop++) {
    const next = transfers.filter(item => item.from.toLowerCase() === cursor.toLowerCase() && BigInt(item.blockNumber) >= block && !ids.includes(item.id))
      .sort((a, b) => Number(BigInt(a.blockNumber) - BigInt(b.blockNumber)) || a.logIndex - b.logIndex)[0];
    if (!next) break;
    ids.push(next.id); addresses.push(next.to); cursor = next.to; block = BigInt(next.blockNumber);
  }
  return {addresses: [...new Set(addresses)], transferIds: ids, hops: ids.length};
}

export function describeBehavior(entity: EntityIntelligence): string[] {
  const labels: string[] = [];
  if (entity.transferCount >= 5) labels.push("high-frequency in this window");
  if (entity.received > entity.sent * 2) labels.push("mostly receiving");
  else if (entity.sent > entity.received * 2) labels.push("mostly sending");
  if (entity.uniqueCounterparties >= 5) labels.push("many counterparties");
  if (entity.transferCount <= 2 && entity.observedVolumeShare >= 10) labels.push("high-volume / low-frequency");
  return labels.length ? labels : ["balanced observed activity"];
}

export function diffSnapshots(previous: IntelligenceSnapshot | null, current: IntelligenceSnapshot, previousTransfers: readonly Transfer[], currentTransfers: readonly Transfer[]): SnapshotDelta | null {
  if (!previous) return null;
  const previousIds = new Set(previousTransfers.map(item => item.id));
  const previousAddresses = new Set(previousTransfers.flatMap(item => [item.from.toLowerCase(), item.to.toLowerCase()]));
  const newTransfers = currentTransfers.filter(item => !previousIds.has(item.id));
  return {
    transferCount: current.transferCount - previous.transferCount,
    volume: current.totalVolume - previous.totalVolume,
    uniqueAddresses: current.uniqueAddresses - previous.uniqueAddresses,
    newTransferIds: newTransfers.map(item => item.id),
    newAddresses: [...new Set(newTransfers.flatMap(item => [item.from, item.to]).filter(item => !previousAddresses.has(item.toLowerCase())))],
  };
}

export function makeAgentTrace(toolsUsed: string[], entitiesInspected: number, transfersEvaluated: number): AgentTrace {
  return {toolsUsed: [...new Set(toolsUsed)], entitiesInspected, transfersEvaluated};
}
