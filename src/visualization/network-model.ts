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

export function uniqueTransfers(transfers: readonly Transfer[]) {
  return [...new Map(transfers.map(transfer => [transferIdentity(transfer), transfer])).values()];
}
