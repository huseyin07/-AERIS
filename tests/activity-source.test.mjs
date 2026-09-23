import test from "node:test";
import assert from "node:assert/strict";
import {createActivityIngestor} from "../src/data/arc-source.ts";
import {reconcileObservation, transferToActivity} from "../src/data/activity-engine.ts";

const address = suffix => `0x${suffix.padStart(40, "0")}`;
const hash = suffix => `0x${suffix.padStart(64, "0")}`;
const now = 2_000_000_000_000;
const latest = 1_000n;
const nowSeconds = BigInt(Math.floor(now / 1000));
const timestampFor = number => nowSeconds - (latest - number);
const tx = (suffix, overrides = {}) => ({hash: hash(suffix), blockNumber: latest, blockHash: hash("b1000"), transactionIndex: Number(suffix), from: address("1"), to: address("2"), input: "0x12345678", ...overrides});
const block = (number, transactions = []) => ({number, hash: hash(`b${number}`), timestamp: timestampFor(number), transactions});
const transferLog = (suffix, blockNumber = 700n, logIndex = 7) => ({args: {from: address("3"), to: address("4"), value: 5_000_000n}, transactionHash: hash(suffix), blockNumber, blockHash: hash(`b${blockNumber}`), transactionIndex: 99, logIndex});

function mockRpc(overrides = {}) {
  return {
    getChainId: async () => 5042,
    getBlockNumber: async () => latest,
    getBlock: async ({blockNumber, includeTransactions}) => block(blockNumber, includeTransactions && blockNumber === latest ? [tx("1")] : []),
    getTransactionReceipt: async ({hash: transactionHash}) => ({transactionHash, transactionIndex: 1, status: "success"}),
    getBytecode: async () => "0x01",
    getLogs: async () => [],
    ...overrides,
  };
}

test("cold ingestion reconstructs USDC activity older than the newest six blocks", async () => {
  let requestedRange;
  const log = transferLog("999", 700n);
  const ingest = createActivityIngestor(mockRpc({getLogs: async args => { requestedRange = args; return [log]; }}), {now: () => now});
  const result = await ingest();
  assert.ok(requestedRange.fromBlock <= 700n);
  assert.equal(requestedRange.toBlock, latest);
  assert.equal(result.events.some(event => event.transactionHash === log.transactionHash), true);
  assert.equal(result.diagnostics.windowCovered, true);
  assert.ok(result.diagnostics.blocksScanned > 6);
});

test("empty newest six blocks do not hide earlier in-window transfers", async () => {
  const result = await createActivityIngestor(mockRpc({getBlock: async ({blockNumber}) => block(blockNumber), getLogs: async () => [transferLog("998", 650n)]}), {now: () => now})();
  assert.equal(result.events.filter(event => event.type === "USDC_TRANSFER").length, 1);
});

test("a genuinely empty complete observation window is healthy and empty", async () => {
  const result = await createActivityIngestor(mockRpc({getBlock: async ({blockNumber}) => block(blockNumber)}), {now: () => now})();
  assert.equal(result.diagnostics.status, "ok");
  assert.equal(result.diagnostics.windowCovered, true);
  assert.equal(result.events.length, 0);
});

test("duplicate USDC logs are deduplicated by transaction hash and log index", async () => {
  const log = transferLog("997", 700n, 3);
  const result = await createActivityIngestor(mockRpc({getLogs: async () => [log, {...log}]}), {now: () => now})();
  assert.equal(result.events.filter(event => event.type === "USDC_TRANSFER").length, 1);
});

test("USDC log failure reports partial rather than healthy empty activity", async () => {
  const result = await createActivityIngestor(mockRpc({getLogs: async () => { throw new Error("rate limit exceeded"); }}), {now: () => now})();
  assert.equal(result.diagnostics.status, "partial");
  assert.match(result.diagnostics.rpcWarnings.join(" "), /rate limit exceeded/);
});

test("frontend reconciliation preserves valid observations through empty polls and expires them", () => {
  const transfer = transferToActivity({id: "x", txHash: hash("900"), blockNumber: "700", logIndex: 1, from: address("3"), to: address("4"), value: "5", fromType: "wallet", toType: "contract"}, {blockHash: hash("b700"), transactionIndex: 1, timestamp: now - 120_000, observedAt: now});
  assert.deepEqual(reconcileObservation([transfer], [], now).map(event => event.id), [transfer.id]);
  assert.deepEqual(reconcileObservation([transfer], [], now + 600_001), []);
});

test("warm and cold ingestion produce equivalent identities for the same chain", async () => {
  const rpc = mockRpc({getLogs: async () => [transferLog("996", 700n)]});
  const warm = createActivityIngestor(rpc, {now: () => now});
  const first = await warm();
  const second = await warm();
  const cold = await createActivityIngestor(rpc, {now: () => now})();
  const ids = result => result.events.map(event => event.id).sort();
  assert.deepEqual(ids(first), ids(second));
  assert.deepEqual(ids(first), ids(cold));
});

test("USDC ingestion is independent of the contract candidate cap", async () => {
  const transactions = Array.from({length: 80}, (_, index) => tx(String(index + 10), {transactionIndex: index}));
  const result = await createActivityIngestor(mockRpc({getBlock: async ({blockNumber, includeTransactions}) => block(blockNumber, includeTransactions && blockNumber === latest ? transactions : []), getLogs: async () => [transferLog("995", 700n)]}), {now: () => now})();
  assert.equal(result.events.some(event => event.type === "USDC_TRANSFER"), true);
});

test("window discovery failure is explicitly partial", async () => {
  const result = await createActivityIngestor(mockRpc({getBlock: async ({blockNumber, includeTransactions}) => {
    if (!includeTransactions && blockNumber === 500n) throw new Error("header unavailable");
    return block(blockNumber, includeTransactions && blockNumber === latest ? [tx("1")] : []);
  }}), {now: () => now})();
  assert.equal(result.diagnostics.status, "partial");
  assert.equal(result.diagnostics.windowCovered, false);
});
