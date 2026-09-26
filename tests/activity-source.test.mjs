import test from "node:test";
import assert from "node:assert/strict";
import {createActivityIngestor, createRecentActivityLoader} from "../src/data/arc-source.ts";
import {observationReference, reconcileObservation, transferToActivity} from "../src/data/activity-engine.ts";
import {CHAIN_HEAD_FUTURE_SKEW_THRESHOLD_MS, CHAIN_HEAD_STALE_THRESHOLD_MS} from "../src/data/arc-source.ts";

const address = suffix => `0x${suffix.padStart(40, "0")}`;
const hash = suffix => `0x${suffix.padStart(64, "0")}`;
const now = 2_000_000_000_000;
const latest = 1_000n;
const nowSeconds = BigInt(Math.floor(now / 1000));
const timestampFor = number => nowSeconds - (latest - number);
const tx = (suffix, overrides = {}) => ({hash: hash(suffix), blockNumber: latest, blockHash: hash("b1000"), transactionIndex: Number(suffix), from: address("1"), to: address("2"), input: "0x12345678", ...overrides});
const block = (number, transactions = []) => ({number, hash: hash(`b${number}`), timestamp: timestampFor(number), transactions});
const transferLog = (suffix, blockNumber = 700n, logIndex = 7) => ({args: {from: address("3"), to: address("4"), value: 5_000_000n}, transactionHash: hash(suffix), blockNumber, blockHash: hash(`b${blockNumber}`), transactionIndex: 99, logIndex});
const requestedBlock = (args, fallback = latest) => args.blockNumber ?? fallback;

function mockRpc(overrides = {}) {
  return {
    getChainId: async () => 5042,
    getBlock: async args => { const number = requestedBlock(args); return block(number, args.includeTransactions && number === latest ? [tx("1")] : []); },
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

test("USDC transfers do not trigger one timestamp-header request per transfer block", async () => {
  const logs = Array.from({length: 120}, (_, index) => transferLog(String(2000 + index), 700n + BigInt(index), index));
  let headerRequests = 0;
  const result = await createActivityIngestor(mockRpc({
    getBlock: async args => {
      const number = requestedBlock(args);
      if (!args.includeTransactions && args.blockTag !== "latest") headerRequests += 1;
      return block(number, args.includeTransactions && number === latest ? [tx("1")] : []);
    },
    getLogs: async () => logs,
  }), {now: () => now})();
  assert.equal(result.events.filter(event => event.type === "USDC_TRANSFER").length, logs.length);
  assert.ok(headerRequests < 20);
  assert.equal(result.diagnostics.rpcRequestCount.timestampHeaders, 11);
  assert.equal(result.events.find(event => event.type === "USDC_TRANSFER")?.timestamp, result.diagnostics.windowReferenceTimestamp);
});

test("empty newest six blocks do not hide earlier in-window transfers", async () => {
  const result = await createActivityIngestor(mockRpc({getBlock: async args => block(requestedBlock(args)), getLogs: async () => [transferLog("998", 650n)]}), {now: () => now})();
  assert.equal(result.events.filter(event => event.type === "USDC_TRANSFER").length, 1);
});

test("a genuinely empty complete observation window is healthy and empty", async () => {
  const result = await createActivityIngestor(mockRpc({getBlock: async args => block(requestedBlock(args))}), {now: () => now})();
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
  const result = await createActivityIngestor(mockRpc({getBlock: async args => { const number = requestedBlock(args); return block(number, args.includeTransactions && number === latest ? transactions : []); }, getLogs: async () => [transferLog("995", 700n)]}), {now: () => now})();
  assert.equal(result.events.some(event => event.type === "USDC_TRANSFER"), true);
});

test("window discovery failure is explicitly partial", async () => {
  const result = await createActivityIngestor(mockRpc({getBlock: async args => {
    const number = requestedBlock(args);
    if (!args.includeTransactions && number === 500n) throw new Error("header unavailable");
    return block(number, args.includeTransactions && number === latest ? [tx("1")] : []);
  }}), {now: () => now})();
  assert.equal(result.diagnostics.status, "partial");
  assert.equal(result.diagnostics.windowCovered, false);
});

test("stale chain head preserves complete chain-relative coverage with partial freshness", async () => {
  const staleBy = 21 * 60 * 60 * 1_000;
  const staleHeadSeconds = BigInt(Math.floor((now - staleBy) / 1000));
  const staleBlock = (number, transactions = []) => ({number, hash: hash(`b${number}`), timestamp: staleHeadSeconds - (latest - number), transactions});
  let requestedRange;
  const result = await createActivityIngestor(mockRpc({
    getBlock: async args => { const number = requestedBlock(args); return staleBlock(number, args.includeTransactions && number === latest ? [tx("1")] : []); },
    getLogs: async args => { requestedRange = args; return [transferLog("994", 700n)]; },
  }), {now: () => now})();
  assert.ok(requestedRange.fromBlock <= 700n);
  assert.ok(result.diagnostics.blocksScanned > 6);
  assert.equal(result.events.some(event => event.transactionHash === hash("994")), true);
  assert.equal(result.diagnostics.windowReferenceTimestamp, Number(staleHeadSeconds) * 1_000);
  assert.equal(result.diagnostics.headAgeMs, staleBy);
  assert.equal(result.diagnostics.headStale, true);
  assert.equal(result.diagnostics.windowCovered, true);
  assert.equal(result.diagnostics.status, "partial");
});

test("frontend reconciliation uses chain reference time when the verified head is stale", () => {
  const reference = now - 21 * 60 * 60 * 1_000;
  const transfer = transferToActivity({id: "stale-head", txHash: hash("901"), blockNumber: "700", logIndex: 1, from: address("3"), to: address("4"), value: "5", fromType: "wallet", toType: "contract"}, {blockHash: hash("b700"), transactionIndex: 1, timestamp: reference - 120_000, observedAt: now});
  assert.deepEqual(reconcileObservation([], [transfer], reference).map(event => event.id), [transfer.id]);
});

test("chain-head stale threshold is diagnostic-only at its exact boundary", async () => {
  for (const [age, expected] of [[CHAIN_HEAD_STALE_THRESHOLD_MS - 1_000, false], [CHAIN_HEAD_STALE_THRESHOLD_MS, false], [CHAIN_HEAD_STALE_THRESHOLD_MS + 1_000, true]]) {
    const headSeconds = BigInt(Math.floor((now - age) / 1000));
    const result = await createActivityIngestor(mockRpc({getBlock: async args => { const number = requestedBlock(args); return {...block(number), timestamp: headSeconds - (latest - number)}; }}), {now: () => now})();
    assert.equal(result.diagnostics.headStale, expected);
    assert.equal(result.diagnostics.windowCovered, true);
    assert.equal(result.diagnostics.status, expected ? "partial" : "ok");
  }
});

test("future-skewed head is explicit, non-negative, and still safely scanned", async () => {
  const skew = CHAIN_HEAD_FUTURE_SKEW_THRESHOLD_MS + 1_000;
  const headSeconds = BigInt(Math.floor((now + skew) / 1000));
  const result = await createActivityIngestor(mockRpc({getBlock: async args => { const number = requestedBlock(args); return {...block(number), timestamp: headSeconds - (latest - number)}; }}), {now: () => now})();
  assert.equal(result.diagnostics.headAgeMs, 0);
  assert.equal(result.diagnostics.headFutureSkewMs, skew);
  assert.equal(result.diagnostics.headFutureSkewed, true);
  assert.equal(result.diagnostics.windowCovered, true);
  assert.equal(result.diagnostics.status, "partial");
  assert.match(result.diagnostics.rpcWarnings.join(" "), /ahead of server time/);
});

test("more than 4096 blocks returns bounded verified data with incomplete coverage", async () => {
  const largeLatest = 10_000n;
  const largeRpc = mockRpc({
    getBlock: async args => { const number = requestedBlock(args, largeLatest); return {number, hash: hash(`b${number}`), timestamp: nowSeconds - (largeLatest - number) / 10n, transactions: []}; },
    getLogs: async () => [],
  });
  const bounded = await createActivityIngestor(largeRpc, {now: () => now})();
  assert.equal(bounded.diagnostics.blocksScanned, 4_096);
  assert.equal(bounded.diagnostics.windowCovered, false);
  assert.equal(bounded.diagnostics.status, "partial");
  assert.match(bounded.diagnostics.rpcWarnings.join(" "), /4096 block safety limit/);
});

test("cold request diagnostics count RPC categories and never refetch a header", async () => {
  const headerRequests = [];
  let latestRequests = 0;
  let blockNumberRequests = 0;
  let tick = 0;
  const result = await createActivityIngestor(mockRpc({getBlockNumber: async () => { blockNumberRequests++; return latest; }, getBlock: async args => {
    const number = requestedBlock(args);
    if (args.blockTag === "latest") latestRequests++;
    if (!args.includeTransactions) headerRequests.push(number.toString());
    return block(number, args.includeTransactions && number === latest ? [tx("1")] : []);
  }}), {now: () => now, monotonicNow: () => tick++})();
  assert.equal(new Set(headerRequests).size, headerRequests.length);
  assert.equal(latestRequests, 1);
  assert.equal(blockNumberRequests, 0);
  assert.equal(result.diagnostics.rpcRequestCount.chainIdentity, 1);
  assert.equal(result.diagnostics.rpcRequestCount.latestHead, 1);
  assert.equal(result.diagnostics.rpcRequestCount.fullBlocks, 6);
  assert.equal(result.diagnostics.rpcRequestCount.logs, 1);
  assert.equal(result.diagnostics.rpcRequestCount.receipts, 0);
  assert.equal(result.diagnostics.rpcRequestCount.timestampHeaders, 11);
  assert.equal(result.diagnostics.rpcRequestCount.bytecode, 1);
  const {total, ...categories} = result.diagnostics.rpcRequestCount;
  assert.equal(total, Object.values(categories).reduce((sum, value) => sum + value, 0));
  assert.equal(total, 21);
  assert.ok(result.diagnostics.stageTimingsMs.total > 0);
});

test("an advancing chain cannot extend a request beyond its captured latest header", async () => {
  let liveHead = latest;
  const fullBlocks = [];
  let logRange;
  const result = await createActivityIngestor(mockRpc({getBlock: async args => {
    if (args.blockTag === "latest") {
      const captured = block(latest);
      liveHead = latest + 1n;
      return captured;
    }
    const number = requestedBlock(args, liveHead);
    if (args.includeTransactions) fullBlocks.push(number);
    return block(number, args.includeTransactions && number === latest ? [tx("1")] : []);
  }, getLogs: async args => { logRange = args; return []; }}), {now: () => now})();
  assert.equal(logRange.toBlock, latest);
  assert.equal(fullBlocks.every(number => number <= latest), true);
  assert.equal(result.latestBlock, latest);
  assert.equal(result.diagnostics.processedBlockRange.to, latest.toString());
  assert.equal(result.diagnostics.windowReferenceTimestamp, Number(timestampFor(latest)) * 1_000);
});

test("a shallow reorg of the captured head rejects the mixed snapshot", async () => {
  let logs = 0;
  const ingest = createActivityIngestor(mockRpc({getBlock: async args => {
    const number = requestedBlock(args);
    if (args.blockTag === "latest") return block(number);
    if (args.includeTransactions && number === latest) return {...block(number), hash: hash("reorg")};
    return block(number);
  }, getLogs: async () => { logs++; return []; }}), {now: () => now});
  await assert.rejects(ingest(), /changed during ingestion/);
  assert.equal(logs, 0);
});

test("out-of-order references never move backwards or resurrect expired events", () => {
  const newer = now;
  const older = now - 60_000;
  assert.equal(observationReference(newer, older), newer);
  assert.equal(observationReference(newer, undefined), newer);
  assert.equal(observationReference(null, undefined, older), older);
  const expired = transferToActivity({id: "expired", txHash: hash("902"), blockNumber: "1", logIndex: 1, from: address("3"), to: address("4"), value: "1", fromType: "wallet", toType: "wallet"}, {blockHash: hash("b1"), transactionIndex: 1, timestamp: newer - 600_001, observedAt: newer});
  assert.deepEqual(reconcileObservation([], [expired], observationReference(newer, older)), []);
});

test("partial activity results are not cached and recover on the next request", async () => {
  let calls = 0;
  const load = createRecentActivityLoader(async () => ({latestBlock: 1n, events: [], diagnostics: {status: ++calls === 1 ? "partial" : "ok"}}), {now: () => now, cacheMs: 6_000});
  assert.equal((await load()).diagnostics.status, "partial");
  assert.equal((await load()).diagnostics.status, "ok");
  assert.equal(calls, 2);
  await load();
  assert.equal(calls, 2);
});

test("cached healthy snapshots are immutable", async () => {
  const event = transferToActivity({id: "cached", txHash: hash("903"), blockNumber: "1", logIndex: 1, from: address("3"), to: address("4"), value: "1", fromType: "wallet", toType: "wallet"}, {blockHash: hash("b1"), transactionIndex: 1, timestamp: now, observedAt: now});
  const result = {latestBlock: 1n, events: [event], diagnostics: {status: "ok", processedBlockRange: {from: "1", to: "1"}, rpcWarnings: [], rpcRequestCount: {}, stageTimingsMs: {}}};
  const load = createRecentActivityLoader(async () => result, {now: () => now});
  const cached = await load();
  assert.throws(() => cached.events.push(event), TypeError);
  assert.throws(() => { cached.diagnostics.status = "partial"; }, TypeError);
  assert.equal((await load()).diagnostics.status, "ok");
});

test("rejected in-flight ingestion is cleared and concurrent callers remain coalesced", async () => {
  let calls = 0;
  const load = createRecentActivityLoader(async () => {
    calls += 1;
    if (calls === 1) throw new Error("temporary RPC failure");
    return {latestBlock: 1n, events: [], diagnostics: {status: "ok"}};
  }, {now: () => now, cacheMs: 6_000});
  await assert.rejects(Promise.all([load(), load()]), /temporary RPC failure/);
  assert.equal(calls, 1);
  assert.equal((await load()).diagnostics.status, "ok");
  assert.equal(calls, 2);
});
