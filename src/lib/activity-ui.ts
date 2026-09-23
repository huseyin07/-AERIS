import type {ArcActivityEvent, Transfer} from "../data/types.ts";
import {transferIdentity} from "../visualization/network-model.ts";
import type {Connection} from "../state/connection.ts";

export const ADDRESS_QUERY = /^0x[\da-f]{40}$/i;
export const TRANSACTION_QUERY = /^0x[\da-f]{64}$/i;

export type ActivityHealth = {
  status: "ok" | "partial" | "error" | null;
  latestBlock?: string;
  processedBlockRange?: {from: string; to: string};
  rpcWarnings: string[];
  lastSuccessfulAt?: number;
};

export function newestTransfers(transfers: readonly Transfer[]) {
  return [...transfers].sort((left, right) =>
    (right.timestamp ?? 0) - (left.timestamp ?? 0) ||
    Number(BigInt(right.blockNumber) - BigInt(left.blockNumber)) ||
    (right.transactionIndex ?? 0) - (left.transactionIndex ?? 0) ||
    right.logIndex - left.logIndex || transferIdentity(left).localeCompare(transferIdentity(right)));
}

export function searchObservation(transfers: readonly Transfer[], events: readonly ArcActivityEvent[], rawQuery: string) {
  const query = rawQuery.trim().toLowerCase();
  if (!query) return {kind: "empty" as const, transfers: newestTransfers(transfers), matchedAddress: null, matchedEvent: null};
  if (ADDRESS_QUERY.test(query)) {
    const matching = transfers.filter(item => item.from.toLowerCase() === query || item.to.toLowerCase() === query);
    const matchedEvent = events.find(item => item.from.toLowerCase() === query || item.to.toLowerCase() === query) ?? null;
    return {kind: "address" as const, transfers: newestTransfers(matching), matchedAddress: matching.length || matchedEvent ? query : null, matchedEvent};
  }
  if (TRANSACTION_QUERY.test(query)) {
    const matching = transfers.filter(item => item.txHash.toLowerCase() === query);
    const matchedEvent = events.find(item => item.transactionHash.toLowerCase() === query) ?? null;
    return {kind: "transaction" as const, transfers: newestTransfers(matching), matchedAddress: null, matchedEvent};
  }
  return {kind: "invalid" as const, transfers: newestTransfers(transfers), matchedAddress: null, matchedEvent: null};
}

export function relativeActivityTime(timestamp: number | undefined, now: number) {
  if (!timestamp || !Number.isFinite(timestamp)) return "—";
  const seconds = Math.max(0, Math.floor((now - timestamp) / 1_000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  return minutes < 60 ? `${minutes}m ago` : `${Math.floor(minutes / 60)}h ago`;
}

export function healthLabel(connection: Connection, health: ActivityHealth, now = Date.now()) {
  if (connection === "unavailable" || connection === "stale" || health.status === "error") return "DEGRADED" as const;
  if (!health.lastSuccessfulAt || now - health.lastSuccessfulAt > 45_000) return connection === "connecting" ? "CONNECTING" as const : "DEGRADED" as const;
  return health.status === "partial" ? "PARTIAL" as const : "LIVE" as const;
}
