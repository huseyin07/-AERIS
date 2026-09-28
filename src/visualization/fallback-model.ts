import type {EntityType, Transfer} from "../data/types.ts";
import {selectSignificantTransfers, stableHash, transferIdentity} from "./network-model.ts";

export type FallbackNode = {address: string; type: EntityType; x: number; y: number};
export type FallbackFlow = {id: string; transfer: Transfer; from: FallbackNode; to: FallbackNode; path: string};

/** A bounded, deterministic map of verified transfers for devices without WebGL. */
export function buildFallbackNetwork(transfers: readonly Transfer[], endpointTypes: Record<string, EntityType>, selectedId: string | null, limit = 18) {
  const count = Math.min(18, Math.max(0, limit));
  const chosen = selectSignificantTransfers(transfers, count);
  const selected = transfers.find(item => transferIdentity(item) === selectedId);
  if (selected && count > 0 && !chosen.some(item => transferIdentity(item) === selectedId)) {
    chosen.splice(Math.max(0, chosen.length - 1), 1, selected);
  }
  const addresses = [...new Set(chosen.flatMap(item => [item.from.toLowerCase(), item.to.toLowerCase()]))].sort();
  const occupied = new Set<number>();
  const nodes = new Map<string, FallbackNode>();
  for (const address of addresses) {
    let slot = stableHash(address) % 36;
    while (occupied.has(slot)) slot = (slot + 1) % 36;
    occupied.add(slot);
    const angle = (Math.floor(slot / 2) / 18) * Math.PI * 2 + (slot % 2) * Math.PI / 18 - Math.PI / 2;
    const radius = slot % 2 ? 166 : 119;
    const transfer = chosen.find(item => item.from.toLowerCase() === address || item.to.toLowerCase() === address)!;
    const observedType = transfer.from.toLowerCase() === address ? transfer.fromType : transfer.toType;
    const classified = endpointTypes[address];
    nodes.set(address, {address, type: classified && classified !== "unknown" ? classified : observedType, x: 320 + Math.cos(angle) * radius, y: 210 + Math.sin(angle) * radius});
  }
  const flows: FallbackFlow[] = chosen.map(transfer => {
    const id = transferIdentity(transfer);
    const from = nodes.get(transfer.from.toLowerCase())!;
    const to = nodes.get(transfer.to.toLowerCase())!;
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const length = Math.hypot(dx, dy) || 1;
    const bend = ((stableHash(id) % 2) ? 1 : -1) * Math.min(25, length * .13);
    const x = (from.x + to.x) / 2 - dy / length * bend;
    const y = (from.y + to.y) / 2 + dx / length * bend;
    return {id, transfer, from, to, path: `M ${from.x.toFixed(1)} ${from.y.toFixed(1)} Q ${x.toFixed(1)} ${y.toFixed(1)} ${to.x.toFixed(1)} ${to.y.toFixed(1)}`};
  });
  return {nodes: [...nodes.values()], flows};
}
