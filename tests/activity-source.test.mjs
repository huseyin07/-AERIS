import test from "node:test";
import assert from "node:assert/strict";
import {createActivityIngestor} from "../src/data/arc-source.ts";

const address = suffix => `0x${suffix.padStart(40, "0")}`;
const hash = suffix => `0x${suffix.padStart(64, "0")}`;
const now = 2_000_000_000_000;
const latest = 105n;
const tx = (suffix, overrides = {}) => ({hash: hash(suffix), blockNumber: latest, blockHash: hash("b105"), transactionIndex: Number(suffix), from: address("1"), to: address("2"), input: "0x12345678", ...overrides});
const block = (number, transactions = []) => ({number, hash: hash(`b${number}`), timestamp: BigInt(Math.floor(now / 1000)), transactions});

function mockRpc(overrides = {}) {
  return {
    getChainId: async () => 5042,
    getBlockNumber: async () => latest,
    getBlock: async ({blockNumber}) => block(blockNumber, blockNumber === latest ? [tx("1")] : []),
    getTransactionReceipt: async ({hash: transactionHash}) => ({transactionHash, transactionIndex: 1, status: "success"}),
    getBytecode: async () => "0x01",
    getLogs: async () => [],
    ...overrides,
  };
}

test("getLogs rate limiting produces partial contract activity, not fake zero activity", async () => {
  const ingest = createActivityIngestor(mockRpc({getLogs: async () => { throw new Error("rate limit exceeded"); }}), {now: () => now});
  const result = await ingest();
  assert.equal(result.diagnostics.status, "partial");
  assert.equal(result.events.some(event => event.type === "CONTRACT_CALL"), true);
  assert.match(result.diagnostics.rpcWarnings.join(" "), /rate limit exceeded/);
});

test("USDC log outside the transaction sample survives using log metadata without a receipt", async () => {
  let receipts = 0;
  const transferHash = hash("999");
  const log = {args: {from: address("3"), to: address("4"), value: 5_000_000n}, transactionHash: transferHash, blockNumber: latest, blockHash: hash("b105"), transactionIndex: 99, logIndex: 7};
  const transactions = Array.from({length: 40}, (_, index) => tx(String(index + 1), {input: "0x", transactionIndex: index}));
  const ingest = createActivityIngestor(mockRpc({
    getBlock: async ({blockNumber}) => block(blockNumber, blockNumber === latest ? transactions : []),
    getLogs: async () => [log],
    getTransactionReceipt: async () => { receipts++; throw new Error("receipt must not be needed"); },
  }), {now: () => now});
  const result = await ingest();
  const event = result.events.find(item => item.type === "USDC_TRANSFER");
  assert.equal(event?.transactionHash, transferHash);
  assert.equal(event?.transactionIndex, 99);
  assert.equal(receipts, 0);
});

test("a fresh cold-start ingestor bootstraps six recent blocks and returns activity", async () => {
  const requested = [];
  const ingest = createActivityIngestor(mockRpc({getBlock: async ({blockNumber}) => { requested.push(blockNumber); return block(blockNumber, blockNumber === latest ? [tx("1")] : []); }}), {now: () => now});
  const result = await ingest();
  assert.deepEqual(requested, [100n, 101n, 102n, 103n, 104n, 105n]);
  assert.deepEqual(result.diagnostics.processedBlockRange, {from: "100", to: "105"});
  assert.equal(result.events.length, 1);
});

test("one failed block reports partial data while successful blocks remain visible", async () => {
  const ingest = createActivityIngestor(mockRpc({getBlock: async ({blockNumber}) => {
    if (blockNumber === 102n) throw new Error("temporary block failure");
    return block(blockNumber, blockNumber === latest ? [tx("1")] : []);
  }}), {now: () => now});
  const result = await ingest();
  assert.equal(result.diagnostics.status, "partial");
  assert.equal(result.events.length, 1);
  assert.match(result.diagnostics.rpcWarnings.join(" "), /temporary block failure/);
});
