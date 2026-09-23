import type {Transfer} from "../data/types.ts";

export type Position = readonly [number, number, number];

export function stableHash(value: string) {
  let result = 2166136261;
  for (let index = 0; index < value.length; index++) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 16777619);
  }
  return result >>> 0;
}

/** A position depends only on the address, never on buffer order or size. */
export function addressPosition(address: string): Position {
  const normalized = address.toLowerCase();
  const first = stableHash(normalized);
  const second = stableHash(`${normalized}:latitude`);
  const longitude = (first / 0xffffffff) * Math.PI * 2;
  const y = (second / 0xffffffff) * 1.84 - 0.92;
  const radial = Math.sqrt(Math.max(0, 1 - y * y));
  const radius = 2.38 + (stableHash(`${normalized}:radius`) % 24) / 100;
  return [Math.cos(longitude) * radial * radius, y * radius, Math.sin(longitude) * radial * radius];
}

export function transferIdentity(transfer: Pick<Transfer, "txHash" | "logIndex">) {
  return `${transfer.txHash.toLowerCase()}:${transfer.logIndex}`;
}

export function shortTransactionHash(txHash: string) {
  return txHash.length > 12 ? `${txHash.slice(0, 6)}...${txHash.slice(-4)}` : txHash;
}

export function significantTransferIds(transfers: readonly Transfer[], limit: number) {
  return [...new Map(transfers.map(transfer => [transferIdentity(transfer), transfer])).values()]
    .sort((left, right) => Number(right.value) - Number(left.value) || transferIdentity(left).localeCompare(transferIdentity(right)))
    .slice(0, Math.max(0, limit))
    .map(transferIdentity);
}

export const VISUAL_CAPS = {
  desktop: {flows: 44, nodes: 84, labels: 3, annotations: 2},
  tablet: {flows: 34, nodes: 84, labels: 2, annotations: 1},
  mobile: {flows: 24, nodes: 56, labels: 1, annotations: 0},
} as const;

/** Deterministic money-flow selection with pair and entity concentration limits. */
export function selectSignificantTransfers(transfers: readonly Transfer[], limit = 500): Transfer[] {
  const unique = uniqueTransfers(transfers);
  if (!unique.length || limit <= 0) return [];
  const ordered = unique.map((transfer, index) => ({transfer, index, amount: Number.isFinite(Number(transfer.value)) ? Number(transfer.value) : 0}))
    .sort((a, b) => b.amount - a.amount || b.index - a.index || transferIdentity(a.transfer).localeCompare(transferIdentity(b.transfer)));
  const pairMax = Math.max(2, Math.ceil(limit * .12)); const entityMax = Math.max(3, Math.ceil(limit * .35));
  const pairs = new Map<string, number>(); const entities = new Map<string, number>(); const selected: Transfer[] = [];
  for (const {transfer} of ordered) {
    const from = transfer.from.toLowerCase(); const to = transfer.to.toLowerCase(); const pair = `${from}>${to}`;
    if ((pairs.get(pair) ?? 0) >= pairMax || (entities.get(from) ?? 0) >= entityMax || (entities.get(to) ?? 0) >= entityMax) continue;
    selected.push(transfer); pairs.set(pair, (pairs.get(pair) ?? 0) + 1); entities.set(from, (entities.get(from) ?? 0) + 1); entities.set(to, (entities.get(to) ?? 0) + 1);
    if (selected.length === limit) break;
  }
  return selected.sort((a, b) => unique.indexOf(a) - unique.indexOf(b));
}

export function uniqueTransfers(transfers: readonly Transfer[]) {
  return [...new Map(transfers.map(transfer => [transferIdentity(transfer), transfer])).values()];
}

/** Keep surviving identities in their existing slots and append genuinely new ones. */
export function reconcileIdentityOrder(previous: readonly string[], incoming: readonly string[]) {
  const next = new Set(incoming);
  const retained = previous.filter(identity => next.has(identity));
  const retainedSet = new Set(retained);
  for (const identity of incoming) if (!retainedSet.has(identity)) {
    retained.push(identity);
    retainedSet.add(identity);
  }
  return retained;
}

export type LabelCandidate = {
  id: string;
  amount: number;
  significant?: boolean;
  agentHighlighted?: boolean;
};

type LabelSelection = {
  selectedId?: string | null;
  hoveredId?: string | null;
  limit: number;
};

/** One canonical, bounded label pipeline. Interaction always displaces automation. */
export function selectLabelCandidates<T extends LabelCandidate>(candidates: readonly T[], selection: LabelSelection): T[] {
  const deduplicated = new Map<string, T>();
  for (const candidate of candidates) {
    const existing = deduplicated.get(candidate.id);
    if (!existing) deduplicated.set(candidate.id, candidate);
    else deduplicated.set(candidate.id, {
      ...(candidate.amount > existing.amount ? candidate : existing),
      significant: Boolean(existing.significant || candidate.significant),
      agentHighlighted: Boolean(existing.agentHighlighted || candidate.agentHighlighted),
    } as T);
  }
  const selectedId = selection.selectedId ?? "";
  const hoveredId = selection.hoveredId ?? "";
  return [...deduplicated.values()]
    .filter(candidate => candidate.id === selectedId || candidate.id === hoveredId || candidate.agentHighlighted || candidate.significant)
    .sort((left, right) =>
      Number(right.id === selectedId) - Number(left.id === selectedId) ||
      Number(right.id === hoveredId) - Number(left.id === hoveredId) ||
      Number(Boolean(right.agentHighlighted)) - Number(Boolean(left.agentHighlighted)) ||
      Number(Boolean(right.significant)) - Number(Boolean(left.significant)) ||
      right.amount - left.amount || left.id.localeCompare(right.id))
    .slice(0, Math.max(0, selection.limit));
}
