import type {ArcActivityEvent, EntityType, Transfer} from "../data/types.ts";
import {transferIdentity} from "../visualization/network-model.ts";
import type {Connection} from "../state/connection.ts";
import {MIN_VISIBLE_USDC} from "../data/threshold.ts";

export const ADDRESS_QUERY = /^0x[\da-f]{40}$/i;
export const TRANSACTION_QUERY = /^0x[\da-f]{64}$/i;
export {MIN_VISIBLE_USDC};

export function visibleUsdcAmount(value: string) {
  const amount = Number(value);
  return Number.isFinite(amount) && amount >= MIN_VISIBLE_USDC;
}

export function visibleTransfers(transfers: readonly Transfer[]) {
  return transfers.filter(item => visibleUsdcAmount(item.value));
}

/** Apply optional verified endpoint classifications to every dashboard view. */
export function resolveTransferEndpointTypes(transfers: readonly Transfer[], endpointTypes: Readonly<Record<string, EntityType>>) {
  return transfers.map(transfer => {
    const fromType = transfer.fromType === "unknown" ? endpointTypes[transfer.from.toLowerCase()] ?? "unknown" : transfer.fromType;
    const toType = transfer.toType === "unknown" ? endpointTypes[transfer.to.toLowerCase()] ?? "unknown" : transfer.toType;
    return fromType === transfer.fromType && toType === transfer.toType ? transfer : {...transfer, fromType, toType};
  });
}

export function visibleEvents(events: readonly ArcActivityEvent[]) {
  return events.filter(item => item.type !== "USDC_TRANSFER" || visibleUsdcAmount(item.amountUSDC));
}

/** A narrower view of the verified, chain-relative ten-minute observation. */
export function sliceObservationWindow(transfers: readonly Transfer[], events: readonly ArcActivityEvent[], referenceTimestamp: number | null, minutes: 1 | 5 | 10) {
  if (minutes === 10 || referenceTimestamp === null) return {transfers, events};
  const cutoff = referenceTimestamp - minutes * 60_000;
  return {
    transfers: transfers.filter(item => item.timestamp !== undefined && item.timestamp >= cutoff && item.timestamp <= referenceTimestamp),
    events: events.filter(item => item.timestamp >= cutoff && item.timestamp <= referenceTimestamp),
  };
}

export type ActivityHealth = {
  status: "ok" | "partial" | "error" | null;
  latestBlock?: string;
  processedBlockRange?: {from: string; to: string};
  contractSampleBlockRange?: {from: string; to: string};
  contractCandidateCount?: number;
  contractCandidateTruncated?: boolean;
  windowCovered?: boolean;
  blocksScanned?: number;
  rpcRequestCount?: number;
  ingestionMs?: number;
  responseMs?: number;
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
