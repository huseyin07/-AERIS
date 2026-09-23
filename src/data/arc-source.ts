import {createPublicClient, http, parseAbiItem} from "viem";
import {ARC, arcChain} from "./arc";
import {normalizeTransfer} from "./normalize";
import {AddressClassificationCache, BlockCursor, normalizeTransactionActivity, pruneObservation, transferToActivity} from "./activity-engine";
import type {ArcActivityEvent, EntityType, HexAddress, Transfer} from "./types";

const transferEvent = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");
const client = createPublicClient({chain: arcChain, transport: http(ARC.rpcUrl, {timeout: 8_000, retryCount: 2, retryDelay: 300})});
const classifications = new AddressClassificationCache();
const cursor = new BlockCursor();
let observed: ArcActivityEvent[] = [];
let inFlight: Promise<{latestBlock: bigint; events: ArcActivityEvent[]}> | null = null;
const MAX_BLOCKS_PER_POLL = 3n;
const MAX_TRANSACTIONS_PER_BLOCK = 96;
const REORG_LOOKBACK = 2n;

async function kind(address: HexAddress): Promise<EntityType> {
  const cached = classifications.get(address);
  if (cached) return cached;
  try {
    const value = await client.getBytecode({address});
    const result = value && value !== "0x" ? "contract" : "wallet";
    classifications.set(address, result); return result;
  } catch { classifications.set(address, "unknown"); return "unknown"; }
}

async function mapConcurrent<T, R>(items: readonly T[], concurrency: number, work: (item: T) => Promise<R>) {
  const output = new Array<R>(items.length); let next = 0;
  await Promise.all(Array.from({length: Math.min(concurrency, items.length)}, async () => { while (next < items.length) { const index = next++; output[index] = await work(items[index]); } }));
  return output;
}

async function processBlock(blockNumber: bigint, observedAt: number) {
  const block = await client.getBlock({blockNumber, includeTransactions: true});
  if (!block.hash || !cursor.shouldProcess(block.number, block.hash)) return [];
  // A changed hash invalidates every previously normalized child of this recent block.
  observed = observed.filter(event => event.blockNumber !== block.number.toString());
  const timestamp = Number(block.timestamp) * 1_000;
  // Keep RPC work bounded on unusually busy blocks so the activity endpoint cannot stall indefinitely.\n  // We prefer the newest transactions; USDC transfers are still collected independently from the full block logs below.\n  const transactions = block.transactions.slice(-MAX_TRANSACTIONS_PER_BLOCK);
  const receipts = await mapConcurrent(transactions, 6, tx => client.getTransactionReceipt({hash: tx.hash}).catch(() => null));
  const receiptByHash = new Map(receipts.flatMap(receipt => receipt ? [[receipt.transactionHash.toLowerCase(), receipt] as const] : []));
  const destinations = [...new Set(transactions.flatMap(tx => tx.to ? [tx.to.toLowerCase() as HexAddress] : []))];
  const types = new Map(await mapConcurrent(destinations, 6, async address => [address, await kind(address)] as const));
  const txEvents = transactions.flatMap(tx => {
    const receipt = receiptByHash.get(tx.hash.toLowerCase());
    if (!receipt || !tx.blockHash || tx.blockNumber === null || tx.transactionIndex === null) return [];
    const event = normalizeTransactionActivity({hash: tx.hash, blockNumber: tx.blockNumber, blockHash: tx.blockHash, transactionIndex: tx.transactionIndex, from: tx.from, to: tx.to, input: tx.input}, receipt, tx.to ? types.get(tx.to.toLowerCase() as HexAddress) ?? "unknown" : "unknown", {timestamp, observedAt});
    return event ? [event] : [];
  });
  const logs = await client.getLogs({address: ARC.usdc, event: transferEvent, fromBlock: block.number, toBlock: block.number});
  const normalized = logs.map(normalizeTransfer).filter((item): item is Transfer => item !== null);
  const transferAddresses = [...new Set(normalized.flatMap(item => [item.from, item.to]))];
  const transferTypes = new Map(await mapConcurrent(transferAddresses, 6, async address => [address, await kind(address)] as const));
  const transferEvents = normalized.flatMap(transfer => {
    const receipt = receiptByHash.get(transfer.txHash.toLowerCase());
    const transactionIndex = receipt?.transactionIndex;
    if (transactionIndex === undefined) return [];
    const classified = {...transfer, fromType: transferTypes.get(transfer.from) ?? "unknown", toType: transferTypes.get(transfer.to) ?? "unknown"};
    return [transferToActivity(classified, {blockHash: block.hash!, transactionIndex, timestamp, observedAt, status: receipt?.status === "success" ? "success" : receipt?.status === "reverted" ? "failed" : "unknown"})];
  });
  cursor.record(block.number, block.hash);
  return [...txEvents, ...transferEvents];
}

async function ingest() {
  const chainId = await client.getChainId();
  if (chainId !== ARC.chainId) throw new Error(`Configured RPC returned chain ${chainId}; Arc Mainnet requires ${ARC.chainId}`);
  const latestBlock = await client.getBlockNumber();
  const initialStart = latestBlock >= 5n ? latestBlock - 5n : 0n;
  const incrementalStart = cursor.lastProcessedBlock === null ? initialStart : cursor.lastProcessedBlock > REORG_LOOKBACK ? cursor.lastProcessedBlock - REORG_LOOKBACK + 1n : 0n;
  const start = latestBlock - incrementalStart + 1n > MAX_BLOCKS_PER_POLL ? latestBlock - MAX_BLOCKS_PER_POLL + 1n : incrementalStart;
  const numbers = Array.from({length: Number(latestBlock - start + 1n)}, (_, index) => start + BigInt(index));
  // Blocks are deliberately sequential; transactions inside each block use bounded concurrency.
  for (const number of numbers) observed.push(...await processBlock(number, Date.now()));
  observed = pruneObservation(observed);
  return {latestBlock, events: observed};
}

export function getRecentActivity() {
  if (!inFlight) inFlight = ingest().finally(() => { inFlight = null; });
  return inFlight;
}
