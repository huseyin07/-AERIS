import {createPublicClient, http, parseAbiItem} from "viem";
import {ARC, arcChain} from "./arc.ts";
import {normalizeTransfer} from "./normalize.ts";
import {AddressClassificationCache, normalizeTransactionActivity, OBSERVATION_WINDOW_MS, pruneObservation, transferToActivity} from "./activity-engine.ts";
import type {ActivityStatus, ArcActivityEvent, EntityType, HexAddress, HexHash, Transfer} from "./types";

const transferEvent = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");
const publicClient = createPublicClient({chain: arcChain, transport: http(ARC.rpcUrl, {timeout: 8_000, retryCount: 1, retryDelay: 500})});
const BOOTSTRAP_BLOCKS = 6n;
const MAX_WINDOW_BLOCKS = 4_096n;
/** Freshness diagnostic only; it never excludes verified chain-relative activity. */
export const CHAIN_HEAD_STALE_THRESHOLD_MS = 2 * 60 * 1_000;
export const CHAIN_HEAD_FUTURE_SKEW_THRESHOLD_MS = 2 * 60 * 1_000;
const MAX_ACTIVITY_TRANSACTIONS = 32;
const MAX_CLASSIFICATION_ENRICHMENT = 12;
const MAX_LOG_BLOCK_SPAN = 256n;
const RPC_CONCURRENCY = 2;
const RESULT_CACHE_MS = 6_000;

type RpcTransaction = {hash: HexHash; blockNumber: bigint | null; blockHash: HexHash | null; transactionIndex: number | null; from: HexAddress; to: HexAddress | null; input: HexHash};
type RpcBlock = {number: bigint; hash: HexHash | null; timestamp: bigint; transactions: RpcTransaction[]};
type RpcReceipt = {transactionHash: HexHash; transactionIndex: number; status: unknown; contractAddress?: HexAddress | null};
type RpcLog = Parameters<typeof normalizeTransfer>[0] & {blockHash?: HexHash | null; transactionIndex?: number | null};

export type ActivityRpc = {
  getChainId(): Promise<number>;
  getBlock(args: {blockNumber?: bigint; blockTag?: "latest"; includeTransactions: boolean}): Promise<RpcBlock>;
  getTransactionReceipt(args: {hash: HexHash}): Promise<RpcReceipt>;
  getBytecode(args: {address: HexAddress}): Promise<HexHash | undefined>;
  getLogs(args: {address: HexAddress; event: typeof transferEvent; fromBlock: bigint; toBlock: bigint}): Promise<RpcLog[]>;
};

export type ActivityDiagnostics = {
  status: "ok" | "partial";
  processedBlockRange: {from: string; to: string};
  eventCount: number;
  transferCount: number;
  rpcWarnings: string[];
  windowStartTimestamp: number;
  windowEndTimestamp: number;
  windowCovered: boolean;
  blocksScanned: number;
  headAgeMs: number;
  headStale: boolean;
  windowReferenceTimestamp: number;
  headFutureSkewMs: number;
  headFutureSkewed: boolean;
  rpcRequestCount: {chainIdentity: number; latestHead: number; timestampHeaders: number; windowDiscoveryHeaders: number; metadataHeaders: number; fullBlocks: number; logs: number; receipts: number; bytecode: number; total: number};
  enrichment: {cacheHits: number; cacheMisses: number; queued: number; performedBlocking: number};
  logCoverage: {chunks: number; splits: number; failedChunks: number};
  eventMetadata: {timestampsAvailable: number; timestampsUnavailable: number};
  stageTimingsMs: {headLookup: number; windowDiscovery: number; contractBlocks: number; usdcLogs: number; metadata: number; normalization: number; total: number};
};

export type ActivityResult = {latestBlock: bigint; events: ArcActivityEvent[]; diagnostics: ActivityDiagnostics};

function warning(error: unknown) {
  if (error instanceof Error) return error.message.slice(0, 240);
  return String(error).slice(0, 240);
}

async function mapConcurrent<T, R>(items: readonly T[], concurrency: number, work: (item: T) => Promise<R>) {
  const output = new Array<R>(items.length);
  let next = 0;
  await Promise.all(Array.from({length: Math.min(concurrency, items.length)}, async () => {
    while (next < items.length) { const index = next++; output[index] = await work(items[index]); }
  }));
  return output;
}

/** A self-contained ingest pass. It deliberately needs no cursor, so every cold serverless invocation can bootstrap. */
export function createActivityIngestor(rpc: ActivityRpc, options: {now?: () => number; monotonicNow?: () => number; scheduleEnrichment?: (task: () => Promise<void>) => void} = {}) {
  const classifications = new AddressClassificationCache();
  const classificationInFlight = new Set<string>();
  const now = options.now ?? Date.now;
  const monotonicNow = options.monotonicNow ?? (() => performance.now());
  const scheduleEnrichment = options.scheduleEnrichment ?? (task => { queueMicrotask(() => { void task(); }); });

  return async function ingest(): Promise<ActivityResult> {
    const warnings: string[] = [];
    const startedAt = monotonicNow();
    const timings = {headLookup: 0, windowDiscovery: 0, contractBlocks: 0, usdcLogs: 0, metadata: 0, normalization: 0, total: 0};
    const counts = {chainIdentity: 1, latestHead: 1, timestampHeaders: 0, windowDiscoveryHeaders: 0, metadataHeaders: 0, fullBlocks: 0, logs: 0, receipts: 0, bytecode: 0, total: 0};
    const logCoverage = {chunks: 0, splits: 0, failedChunks: 0};
    const headStartedAt = monotonicNow();
    const [chainId, latestHeader] = await Promise.all([rpc.getChainId(), rpc.getBlock({blockTag: "latest", includeTransactions: false})]);
    if (chainId !== ARC.chainId) throw new Error(`Configured RPC returned chain ${chainId}; Arc Mainnet requires ${ARC.chainId}`);
    const latestBlock = latestHeader.number;
    const observedAt = now();
    const headers = new Map<string, RpcBlock>();
    async function header(number: bigint, category: "discovery" | "metadata" = "discovery") {
      const key = number.toString();
      const cached = headers.get(key);
      if (cached) return cached;
      counts.timestampHeaders += 1;
      if (category === "discovery") counts.windowDiscoveryHeaders += 1;
      else counts.metadataHeaders += 1;
      const value = await rpc.getBlock({blockNumber: number, includeTransactions: false});
      headers.set(key, value);
      return value;
    }
    headers.set(latestBlock.toString(), latestHeader);
    timings.headLookup = monotonicNow() - headStartedAt;
    const windowReferenceTimestamp = Number(latestHeader.timestamp) * 1_000;
    const headAgeMs = Math.max(0, observedAt - windowReferenceTimestamp);
    const headFutureSkewMs = Math.max(0, windowReferenceTimestamp - observedAt);
    const headStale = headAgeMs > CHAIN_HEAD_STALE_THRESHOLD_MS;
    const headFutureSkewed = headFutureSkewMs > CHAIN_HEAD_FUTURE_SKEW_THRESHOLD_MS;
    if (headStale) warnings.push(`Arc chain head is ${headAgeMs}ms behind server time`);
    if (headFutureSkewed) warnings.push(`Arc chain head is ${headFutureSkewMs}ms ahead of server time`);
    const cutoff = windowReferenceTimestamp - OBSERVATION_WINDOW_MS;
    let start = latestBlock;
    let rangeCovered = true;
    const lowerBound = latestBlock >= MAX_WINDOW_BLOCKS - 1n ? latestBlock - MAX_WINDOW_BLOCKS + 1n : 0n;
    const discoveryStartedAt = monotonicNow();
    try {
      const lowerHeader = await header(lowerBound);
      if (Number(lowerHeader.timestamp) * 1_000 > cutoff && lowerBound > 0n) {
        start = lowerBound;
        rangeCovered = false;
        warnings.push(`Observation window exceeds ${MAX_WINDOW_BLOCKS} block safety limit`);
      } else {
        let low = lowerBound;
        let high = latestBlock;
        while (low < high) {
          const middle = (low + high) / 2n;
          const middleHeader = await header(middle);
          if (Number(middleHeader.timestamp) * 1_000 < cutoff) low = middle + 1n;
          else high = middle;
        }
        start = low;
      }
    } catch (error) {
      start = latestBlock >= BOOTSTRAP_BLOCKS - 1n ? latestBlock - BOOTSTRAP_BLOCKS + 1n : 0n;
      rangeCovered = false;
      warnings.push(`Observation window discovery: ${warning(error)}`);
    }
    timings.windowDiscovery = monotonicNow() - discoveryStartedAt;

    // Contract activity remains a bounded recent sample. USDC logs are queried
    // independently over the complete discovered observation window.
    const contractStart = latestBlock >= BOOTSTRAP_BLOCKS - 1n ? latestBlock - BOOTSTRAP_BLOCKS + 1n : 0n;
    const contractStartedAt = monotonicNow();
    const contractNumbers = Array.from({length: Number(latestBlock - contractStart + 1n)}, (_, index) => contractStart + BigInt(index));
    const loadedBlocks = await mapConcurrent(contractNumbers, RPC_CONCURRENCY, async number => {
      counts.fullBlocks += 1;
      try { return await rpc.getBlock({blockNumber: number, includeTransactions: true}); }
      catch (error) { warnings.push(`eth_getBlockByNumber ${number}: ${warning(error)}`); return null; }
    });
    const blocks = loadedBlocks.filter((block): block is RpcBlock => block !== null);
    timings.contractBlocks = monotonicNow() - contractStartedAt;
    if (!blocks.length) throw new Error(`Unable to retrieve Arc blocks ${contractStart}-${latestBlock}`);
    const loadedHead = blocks.find(block => block.number === latestBlock);
    if (!latestHeader.hash || !loadedHead?.hash || loadedHead.hash.toLowerCase() !== latestHeader.hash.toLowerCase()) {
      throw new Error(`Arc head ${latestBlock} changed during ingestion; retrying with a fresh snapshot is required`);
    }

    const candidates = blocks.flatMap(block => block.transactions
      .filter(tx => tx.to === null || tx.input !== "0x")
      .map(tx => ({tx, block})))
      .slice(-MAX_ACTIVITY_TRANSACTIONS);

    let rawLogs: RpcLog[] = [];
    let logsCovered = true;
    const logsStartedAt = monotonicNow();
    const ranges: Array<{from: bigint; to: bigint}> = [];
    for (let from = start; from <= latestBlock; from += MAX_LOG_BLOCK_SPAN) ranges.push({from, to: from + MAX_LOG_BLOCK_SPAN - 1n > latestBlock ? latestBlock : from + MAX_LOG_BLOCK_SPAN - 1n});
    async function loadLogRange(from: bigint, to: bigint): Promise<RpcLog[]> {
      counts.logs += 1; logCoverage.chunks += 1;
      try { return await rpc.getLogs({address: ARC.usdc, event: transferEvent, fromBlock: from, toBlock: to}); }
      catch (error) {
        const message = warning(error);
        if (from < to && /limit|too many|range|response size/i.test(message)) {
          logCoverage.splits += 1;
          const middle = (from + to) / 2n;
          const left = await loadLogRange(from, middle);
          const right = await loadLogRange(middle + 1n, to);
          return [...left, ...right];
        }
        logsCovered = false; logCoverage.failedChunks += 1;
        warnings.push(`eth_getLogs USDC ${from}-${to}: ${message}`);
        return [];
      }
    }
    rawLogs = (await mapConcurrent(ranges, RPC_CONCURRENCY, range => loadLogRange(range.from, range.to))).flat();
    timings.usdcLogs = monotonicNow() - logsStartedAt;
    const metadataStartedAt = monotonicNow();
    const transfers = [...new Map(rawLogs.map(normalizeTransfer).filter((item): item is Transfer => item !== null).map(transfer => [`${transfer.txHash.toLowerCase()}:${transfer.logIndex}`, transfer])).values()];
    let transferMetadataCovered = true;

    const addresses = [...new Set([
      ...candidates.flatMap(({tx}) => tx.to ? [tx.to.toLowerCase() as HexAddress] : []),
      ...transfers.flatMap(transfer => [transfer.from, transfer.to]),
    ])];
    const types = new Map<string, EntityType>();
    const uncached: HexAddress[] = [];
    for (const address of addresses) {
      const cached = classifications.get(address);
      if (cached) types.set(address, cached);
      else uncached.push(address);
    }
    const enrichmentAddresses = uncached.filter(address => !classificationInFlight.has(address)).slice(0, MAX_CLASSIFICATION_ENRICHMENT);

    // Receipts are required for deployments, but not for ordinary calls. Missing status must not erase a valid call.
    const deployments = candidates.filter(({tx}) => tx.to === null);
    const deploymentReceipts = await mapConcurrent(deployments, RPC_CONCURRENCY, async ({tx}) => {
      counts.receipts += 1;
      try { return await rpc.getTransactionReceipt({hash: tx.hash}); }
      catch (error) { warnings.push(`eth_getTransactionReceipt ${tx.hash}: ${warning(error)}`); return null; }
    });
    const receiptByHash = new Map(deploymentReceipts.flatMap(receipt => receipt ? [[receipt.transactionHash.toLowerCase(), receipt] as const] : []));

    // Modern log responses already contain transactionIndex. Fetch only deduplicated receipts for logs that omit it.
    const missingLogHashes = [...new Set(transfers.filter(transfer => transfer.transactionIndex === undefined).map(transfer => transfer.txHash))];
    const missingReceipts = await mapConcurrent(missingLogHashes, RPC_CONCURRENCY, async hash => {
      counts.receipts += 1;
      try { return await rpc.getTransactionReceipt({hash}); }
      catch (error) { warnings.push(`eth_getTransactionReceipt ${hash}: ${warning(error)}`); return null; }
    });
    for (const receipt of missingReceipts) if (receipt) receiptByHash.set(receipt.transactionHash.toLowerCase(), receipt);
    timings.metadata = monotonicNow() - metadataStartedAt;

    const normalizationStartedAt = monotonicNow();
    const txEvents = candidates.flatMap(({tx, block}) => {
      if (!block.hash || !tx.blockHash || tx.blockNumber === null || tx.transactionIndex === null) return [];
      const receipt = receiptByHash.get(tx.hash.toLowerCase()) ?? {status: undefined};
      const event = normalizeTransactionActivity({hash: tx.hash, blockNumber: tx.blockNumber, blockHash: tx.blockHash, transactionIndex: tx.transactionIndex, from: tx.from, to: tx.to, input: tx.input}, receipt, tx.to ? types.get(tx.to.toLowerCase() as HexAddress) ?? "unknown" : "unknown", {timestamp: Number(block.timestamp) * 1_000, observedAt});
      return event ? [event] : [];
    });
    const transferEvents = transfers.flatMap(transfer => {
      const receipt = receiptByHash.get(transfer.txHash.toLowerCase());
      const transactionIndex = transfer.transactionIndex ?? receipt?.transactionIndex;
      const blockHash = transfer.blockHash;
      if (transactionIndex === undefined || !blockHash) {
        transferMetadataCovered = false;
        warnings.push(`Incomplete USDC log ${transfer.txHash}:${transfer.logIndex}`);
        return [];
      }
      const status: ActivityStatus = receipt?.status === "success" ? "success" : receipt?.status === "reverted" ? "failed" : "unknown";
      return [transferToActivity({...transfer, fromType: types.get(transfer.from) ?? "unknown", toType: types.get(transfer.to) ?? "unknown"}, {blockHash, transactionIndex, observedAt, status})];
    });

    const observed = pruneObservation([...txEvents, ...transferEvents], windowReferenceTimestamp, undefined, start);
    timings.normalization = monotonicNow() - normalizationStartedAt;
    const windowCovered = rangeCovered && logsCovered && transferMetadataCovered;
    counts.total = counts.chainIdentity + counts.latestHead + counts.timestampHeaders + counts.fullBlocks + counts.logs + counts.receipts + counts.bytecode;
    timings.total = monotonicNow() - startedAt;
    const diagnostics: ActivityDiagnostics = {
      status: warnings.length ? "partial" : "ok",
      processedBlockRange: {from: start.toString(), to: latestBlock.toString()},
      eventCount: observed.length,
      transferCount: observed.filter(event => event.type === "USDC_TRANSFER").length,
      rpcWarnings: warnings,
      windowStartTimestamp: cutoff,
      windowEndTimestamp: windowReferenceTimestamp,
      windowCovered,
      blocksScanned: Number(latestBlock - start + 1n),
      headAgeMs,
      headStale,
      windowReferenceTimestamp,
      headFutureSkewMs,
      headFutureSkewed,
      rpcRequestCount: counts,
      enrichment: {cacheHits: types.size, cacheMisses: uncached.length, queued: enrichmentAddresses.length, performedBlocking: 0},
      logCoverage,
      eventMetadata: {timestampsAvailable: txEvents.length, timestampsUnavailable: transferEvents.length},
      stageTimingsMs: timings,
    };
    if (enrichmentAddresses.length) {
      for (const address of enrichmentAddresses) classificationInFlight.add(address);
      scheduleEnrichment(async () => {
        await mapConcurrent(enrichmentAddresses, RPC_CONCURRENCY, async address => {
          try {
            if (!classifications.get(address)) {
              const code = await rpc.getBytecode({address});
              classifications.set(address, code && code !== "0x" ? "contract" : "wallet");
            }
          } catch { /* Enrichment failure leaves the address explicitly unknown. */ }
          finally { classificationInFlight.delete(address); }
        });
      });
    }
    return {latestBlock, events: observed, diagnostics};
  };
}

const ingest = createActivityIngestor(publicClient as unknown as ActivityRpc);
function freezeActivityResult(value: ActivityResult) {
  for (const event of value.events) Object.freeze(event);
  Object.freeze(value.events);
  if (value.diagnostics.processedBlockRange) Object.freeze(value.diagnostics.processedBlockRange);
  if (value.diagnostics.rpcWarnings) Object.freeze(value.diagnostics.rpcWarnings);
  if (value.diagnostics.rpcRequestCount) Object.freeze(value.diagnostics.rpcRequestCount);
  if (value.diagnostics.enrichment) Object.freeze(value.diagnostics.enrichment);
  if (value.diagnostics.logCoverage) Object.freeze(value.diagnostics.logCoverage);
  if (value.diagnostics.eventMetadata) Object.freeze(value.diagnostics.eventMetadata);
  if (value.diagnostics.stageTimingsMs) Object.freeze(value.diagnostics.stageTimingsMs);
  Object.freeze(value.diagnostics);
  return Object.freeze(value);
}

export function createRecentActivityLoader(load: () => Promise<ActivityResult>, options: {now?: () => number; cacheMs?: number} = {}) {
  const now = options.now ?? Date.now;
  const cacheMs = options.cacheMs ?? RESULT_CACHE_MS;
  let cached: {expiresAt: number; value: ActivityResult} | null = null;
  let inFlight: Promise<ActivityResult> | null = null;
  return function getRecent() {
    if (cached && cached.expiresAt > now()) return Promise.resolve(cached.value);
    if (!inFlight) inFlight = load().then(value => {
      if (value.diagnostics.status === "ok") {
        value = freezeActivityResult(value);
        cached = {expiresAt: now() + cacheMs, value};
      }
      return value;
    }).finally(() => { inFlight = null; });
    return inFlight;
  };
}

export const getRecentActivity = createRecentActivityLoader(ingest);
