import {formatUnits, isAddress} from "viem";
import type {ActivityStatus, ArcActivityEvent, EntityType, HexAddress, HexHash, Transfer} from "./types";

export const OBSERVATION_WINDOW_MS = 10 * 60 * 1_000;
export const MAX_OBSERVED_EVENTS = 20_000;
export const MAX_VISUALIZATION_CANDIDATES = 500;

export function transactionActivityId(hash: string) { return `arc:5042:tx:${hash.toLowerCase()}`; }
export function usdcActivityId(hash: string, logIndex: number) { return `arc:5042:usdc:${hash.toLowerCase()}:${logIndex}`; }
export function contractCallActivityId(hash: string) { return `arc:5042:call:${hash.toLowerCase()}`; }
export function deploymentActivityId(hash: string, address: string) { return `arc:5042:deployment:${hash.toLowerCase()}:${address.toLowerCase()}`; }
export function receiptStatus(status: unknown): ActivityStatus {
  return status === "success" || status === 1 || status === 1n || status === "0x1" ? "success"
    : status === "reverted" || status === 0 || status === 0n || status === "0x0" ? "failed" : "unknown";
}

export type NormalizedTransaction = {hash: HexHash; blockNumber: bigint; blockHash: HexHash; transactionIndex: number; from: HexAddress; to: HexAddress | null; input: HexHash};
export type NormalizedReceipt = {status: unknown; contractAddress?: HexAddress | null};

type Context = {timestamp: number; observedAt: number};
export function normalizeTransactionActivity(tx: NormalizedTransaction, receipt: NormalizedReceipt, toType: EntityType, context: Context): ArcActivityEvent | null {
  const status = receiptStatus(receipt.status);
  const base = {chainId: 5042 as const, blockNumber: tx.blockNumber.toString(), blockHash: tx.blockHash, transactionHash: tx.hash, transactionIndex: tx.transactionIndex, timestamp: context.timestamp, from: tx.from.toLowerCase() as HexAddress, status, source: "arc-mainnet-rpc" as const, observedAt: context.observedAt, parentTransactionId: transactionActivityId(tx.hash)};
  if (tx.to === null) {
    if (status !== "success" || !receipt.contractAddress || !isAddress(receipt.contractAddress)) return null;
    const deployed = receipt.contractAddress.toLowerCase() as HexAddress;
    return {...base, id: deploymentActivityId(tx.hash, deployed), type: "CONTRACT_DEPLOYMENT", to: deployed, deployedContract: deployed};
  }
  if (toType !== "contract") return null;
  const to = tx.to.toLowerCase() as HexAddress;
  const selector = /^0x[\da-f]{8}/i.test(tx.input) ? tx.input.slice(0, 10).toLowerCase() as `0x${string}` : undefined;
  return {...base, id: contractCallActivityId(tx.hash), type: "CONTRACT_CALL", to, ...(selector ? {inputSelector: selector} : {})};
}

export function transferToActivity(transfer: Transfer, context: {blockHash: HexHash; transactionIndex: number; timestamp: number; observedAt: number; status?: ActivityStatus}): ArcActivityEvent {
  const raw = transfer.amountRaw ?? String(BigInt(Math.round(Number(transfer.value) * 1_000_000)));
  return {id: usdcActivityId(transfer.txHash, transfer.logIndex), type: "USDC_TRANSFER", chainId: 5042, blockNumber: transfer.blockNumber, blockHash: context.blockHash, transactionHash: transfer.txHash, transactionIndex: context.transactionIndex, timestamp: context.timestamp, from: transfer.from.toLowerCase() as HexAddress, to: transfer.to.toLowerCase() as HexAddress, status: context.status ?? "unknown", source: "arc-mainnet-rpc", observedAt: context.observedAt, parentTransactionId: transactionActivityId(transfer.txHash), logIndex: transfer.logIndex, amountRaw: raw, amountUSDC: transfer.value || formatUnits(BigInt(raw), 6), fromType: transfer.fromType, toType: transfer.toType};
}

export function pruneObservation(events: readonly ArcActivityEvent[], now = Date.now(), limit = MAX_OBSERVED_EVENTS) {
  const cutoff = now - OBSERVATION_WINDOW_MS;
  const deduped = new Map<string, ArcActivityEvent>();
  for (const event of events) if (event.timestamp >= cutoff && event.timestamp <= now + 60_000) deduped.set(event.id, event);
  return [...deduped.values()].sort((a, b) => a.timestamp - b.timestamp || Number(BigInt(a.blockNumber) - BigInt(b.blockNumber)) || a.transactionIndex - b.transactionIndex || a.id.localeCompare(b.id)).slice(-limit);
}

/** Preserve still-valid verified observations across empty or partial polls. */
export function reconcileObservation(current: readonly ArcActivityEvent[], incoming: readonly ArcActivityEvent[], now = Date.now()) {
  return pruneObservation([...incoming, ...current], now);
}

export class BlockCursor {
  private hashes = new Map<string, string>();
  lastProcessedBlock: bigint | null = null;
  shouldProcess(number: bigint, hash: string) { return this.hashes.get(number.toString()) !== hash.toLowerCase(); }
  record(number: bigint, hash: string) {
    this.hashes.set(number.toString(), hash.toLowerCase());
    this.lastProcessedBlock = this.lastProcessedBlock === null || number > this.lastProcessedBlock ? number : this.lastProcessedBlock;
    if (this.hashes.size > 64) this.hashes.delete([...this.hashes.keys()].sort((a, b) => Number(BigInt(a) - BigInt(b)))[0]);
  }
}

export class AddressClassificationCache {
  private values = new Map<string, EntityType>();
  private readonly max: number;
  constructor(max = 4_096) { this.max = max; }
  get(address: string) { const key = address.toLowerCase(); const value = this.values.get(key); if (value) { this.values.delete(key); this.values.set(key, value); } return value; }
  set(address: string, value: EntityType) { const key = address.toLowerCase(); this.values.delete(key); this.values.set(key, value); while (this.values.size > this.max) this.values.delete(this.values.keys().next().value!); }
  get size() { return this.values.size; }
}

export function eventsToTransfers(events: readonly ArcActivityEvent[]): Transfer[] {
  return events.flatMap(event => event.type !== "USDC_TRANSFER" ? [] : [{id: `${event.transactionHash}:${event.logIndex}`, txHash: event.transactionHash, blockNumber: event.blockNumber, blockHash: event.blockHash, transactionIndex: event.transactionIndex, timestamp: event.timestamp, logIndex: event.logIndex, from: event.from, to: event.to, value: event.amountUSDC, amountRaw: event.amountRaw, fromType: event.fromType, toType: event.toType}]);
}
