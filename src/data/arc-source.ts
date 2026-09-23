import {createPublicClient, http, parseAbiItem} from "viem";
import {ARC, arcChain} from "./arc.ts";
import {normalizeTransfer} from "./normalize.ts";
import {AddressClassificationCache, normalizeTransactionActivity, OBSERVATION_WINDOW_MS, pruneObservation, transferToActivity} from "./activity-engine.ts";
import type {ActivityStatus, ArcActivityEvent, EntityType, HexAddress, HexHash, Transfer} from "./types";

const transferEvent = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");
const publicClient = createPublicClient({chain: arcChain, transport: http(ARC.rpcUrl, {timeout: 8_000, retryCount: 1, retryDelay: 500})});
const BOOTSTRAP_BLOCKS = 6n;
const MAX_WINDOW_BLOCKS = 4_096n;
const MAX_ACTIVITY_TRANSACTIONS = 32;
const RPC_CONCURRENCY = 2;
const RESULT_CACHE_MS = 12_000;

type RpcTransaction = {hash: HexHash; blockNumber: bigint | null; blockHash: HexHash | null; transactionIndex: number | null; from: HexAddress; to: HexAddress | null; input: HexHash};
type RpcBlock = {number: bigint; hash: HexHash | null; timestamp: bigint; transactions: RpcTransaction[]};
type RpcReceipt = {transactionHash: HexHash; transactionIndex: number; status: unknown; contractAddress?: HexAddress | null};
type RpcLog = Parameters<typeof normalizeTransfer>[0] & {blockHash?: HexHash | null; transactionIndex?: number | null};

export type ActivityRpc = {
  getChainId(): Promise<number>;
  getBlockNumber(): Promise<bigint>;
  getBlock(args: {blockNumber: bigint; includeTransactions: boolean}): Promise<RpcBlock>;
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
export function createActivityIngestor(rpc: ActivityRpc, options: {now?: () => number} = {}) {
  const classifications = new AddressClassificationCache();
  const now = options.now ?? Date.now;

  return async function ingest(): Promise<ActivityResult> {
    const warnings: string[] = [];
    const chainId = await rpc.getChainId();
    if (chainId !== ARC.chainId) throw new Error(`Configured RPC returned chain ${chainId}; Arc Mainnet requires ${ARC.chainId}`);
    const latestBlock = await rpc.getBlockNumber();
    const observedAt = now();
    const cutoff = observedAt - OBSERVATION_WINDOW_MS;
    const headers = new Map<string, RpcBlock>();
    async function header(number: bigint) {
      const key = number.toString();
      const cached = headers.get(key);
      if (cached) return cached;
      const value = await rpc.getBlock({blockNumber: number, includeTransactions: false});
      headers.set(key, value);
      return value;
    }
    const latestHeader = await header(latestBlock);
    let start = latestBlock;
    let windowCovered = true;
    const lowerBound = latestBlock >= MAX_WINDOW_BLOCKS - 1n ? latestBlock - MAX_WINDOW_BLOCKS + 1n : 0n;
    try {
      const lowerHeader = await header(lowerBound);
      if (Number(lowerHeader.timestamp) * 1_000 > cutoff && lowerBound > 0n) {
        start = lowerBound;
        windowCovered = false;
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
      windowCovered = false;
      warnings.push(`Observation window discovery: ${warning(error)}`);
    }

    // Contract activity remains a bounded recent sample. USDC logs are queried
    // independently over the complete discovered observation window.
    const contractStart = latestBlock >= BOOTSTRAP_BLOCKS - 1n ? latestBlock - BOOTSTRAP_BLOCKS + 1n : 0n;
    const blocks: RpcBlock[] = [];
    for (let number = contractStart; number <= latestBlock; number++) {
      try { blocks.push(await rpc.getBlock({blockNumber: number, includeTransactions: true})); }
      catch (error) { warnings.push(`eth_getBlockByNumber ${number}: ${warning(error)}`); }
    }
    if (!blocks.length) throw new Error(`Unable to retrieve Arc blocks ${contractStart}-${latestBlock}`);

    const blockByNumber = new Map([...headers, ...blocks.map(block => [block.number.toString(), block] as const)]);
    const candidates = blocks.flatMap(block => block.transactions
      .filter(tx => tx.to === null || tx.input !== "0x")
      .map(tx => ({tx, block})))
      .slice(-MAX_ACTIVITY_TRANSACTIONS);

    let rawLogs: RpcLog[] = [];
    try { rawLogs = await rpc.getLogs({address: ARC.usdc, event: transferEvent, fromBlock: start, toBlock: latestBlock}); }
    catch (error) { warnings.push(`eth_getLogs USDC ${start}-${latestBlock}: ${warning(error)}`); }
    const transfers = [...new Map(rawLogs.map(normalizeTransfer).filter((item): item is Transfer => item !== null).map(transfer => [`${transfer.txHash.toLowerCase()}:${transfer.logIndex}`, transfer])).values()];
    const missingBlocks = [...new Set(transfers.map(transfer => transfer.blockNumber))].filter(number => !blockByNumber.has(number));
    await mapConcurrent(missingBlocks, RPC_CONCURRENCY, async number => {
      try { blockByNumber.set(number, await header(BigInt(number))); }
      catch (error) { warnings.push(`eth_getBlockByNumber ${number}: ${warning(error)}`); }
    });

    const addresses = [...new Set([
      ...candidates.flatMap(({tx}) => tx.to ? [tx.to.toLowerCase() as HexAddress] : []),
      ...transfers.flatMap(transfer => [transfer.from, transfer.to]),
    ])];
    const types = new Map(await mapConcurrent(addresses, RPC_CONCURRENCY, async address => {
      const cached = classifications.get(address);
      if (cached) return [address, cached] as const;
      try {
        const code = await rpc.getBytecode({address});
        const type: EntityType = code && code !== "0x" ? "contract" : "wallet";
        classifications.set(address, type);
        return [address, type] as const;
      } catch (error) {
        warnings.push(`eth_getCode ${address}: ${warning(error)}`);
        return [address, "unknown" as const] as const;
      }
    }));

    // Receipts are required for deployments, but not for ordinary calls. Missing status must not erase a valid call.
    const deployments = candidates.filter(({tx}) => tx.to === null);
    const deploymentReceipts = await mapConcurrent(deployments, RPC_CONCURRENCY, async ({tx}) => {
      try { return await rpc.getTransactionReceipt({hash: tx.hash}); }
      catch (error) { warnings.push(`eth_getTransactionReceipt ${tx.hash}: ${warning(error)}`); return null; }
    });
    const receiptByHash = new Map(deploymentReceipts.flatMap(receipt => receipt ? [[receipt.transactionHash.toLowerCase(), receipt] as const] : []));

    // Modern log responses already contain transactionIndex. Fetch only deduplicated receipts for logs that omit it.
    const missingLogHashes = [...new Set(transfers.filter(transfer => transfer.transactionIndex === undefined).map(transfer => transfer.txHash))];
    const missingReceipts = await mapConcurrent(missingLogHashes, RPC_CONCURRENCY, async hash => {
      try { return await rpc.getTransactionReceipt({hash}); }
      catch (error) { warnings.push(`eth_getTransactionReceipt ${hash}: ${warning(error)}`); return null; }
    });
    for (const receipt of missingReceipts) if (receipt) receiptByHash.set(receipt.transactionHash.toLowerCase(), receipt);

    const txEvents = candidates.flatMap(({tx, block}) => {
      if (!block.hash || !tx.blockHash || tx.blockNumber === null || tx.transactionIndex === null) return [];
      const receipt = receiptByHash.get(tx.hash.toLowerCase()) ?? {status: undefined};
      const event = normalizeTransactionActivity({hash: tx.hash, blockNumber: tx.blockNumber, blockHash: tx.blockHash, transactionIndex: tx.transactionIndex, from: tx.from, to: tx.to, input: tx.input}, receipt, tx.to ? types.get(tx.to.toLowerCase() as HexAddress) ?? "unknown" : "unknown", {timestamp: Number(block.timestamp) * 1_000, observedAt});
      return event ? [event] : [];
    });
    const transferEvents = transfers.flatMap(transfer => {
      const block = blockByNumber.get(transfer.blockNumber);
      const receipt = receiptByHash.get(transfer.txHash.toLowerCase());
      const transactionIndex = transfer.transactionIndex ?? receipt?.transactionIndex;
      const blockHash = transfer.blockHash ?? block?.hash;
      if (transactionIndex === undefined || !blockHash || !block) {
        warnings.push(`Incomplete USDC log ${transfer.txHash}:${transfer.logIndex}`);
        return [];
      }
      const status: ActivityStatus = receipt?.status === "success" ? "success" : receipt?.status === "reverted" ? "failed" : "unknown";
      return [transferToActivity({...transfer, fromType: types.get(transfer.from) ?? "unknown", toType: types.get(transfer.to) ?? "unknown"}, {blockHash, transactionIndex, timestamp: Number(block.timestamp) * 1_000, observedAt, status})];
    });

    const observed = pruneObservation([...txEvents, ...transferEvents], observedAt);
    const diagnostics: ActivityDiagnostics = {
      status: warnings.length ? "partial" : "ok",
      processedBlockRange: {from: start.toString(), to: latestBlock.toString()},
      eventCount: observed.length,
      transferCount: observed.filter(event => event.type === "USDC_TRANSFER").length,
      rpcWarnings: warnings,
      windowStartTimestamp: cutoff,
      windowEndTimestamp: Number(latestHeader.timestamp) * 1_000,
      windowCovered,
      blocksScanned: Number(latestBlock - start + 1n),
    };
    return {latestBlock, events: observed, diagnostics};
  };
}

const ingest = createActivityIngestor(publicClient as unknown as ActivityRpc);
let cached: {expiresAt: number; value: ActivityResult} | null = null;
let inFlight: Promise<ActivityResult> | null = null;

export function getRecentActivity() {
  if (cached && cached.expiresAt > Date.now()) return Promise.resolve(cached.value);
  if (!inFlight) inFlight = ingest().then(value => { cached = {expiresAt: Date.now() + RESULT_CACHE_MS, value}; return value; }).finally(() => { inFlight = null; });
  return inFlight;
}
