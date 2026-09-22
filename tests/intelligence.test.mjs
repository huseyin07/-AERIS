import test from "node:test";
import assert from "node:assert/strict";
import {buildIntelligenceSnapshot} from "../src/intelligence/engine.ts";
import {answerDeterministically} from "../src/ai/deterministic.ts";
import {connectionAfterFailure} from "../src/state/connection.ts";

const address = suffix => `0x${suffix.padStart(40, "0")}`;
const hash = suffix => `0x${suffix.padStart(64, "0")}`;
const transfer = (id, from, to, value, fromType = "wallet", toType = "wallet") => ({id, txHash: hash(id), blockNumber: "100", logIndex: Number(id), from, to, value, fromType, toType});
const a = address("1"), b = address("2"), c = address("3"), contract = address("4");
const transfers = [
  transfer("1", a, b, "10"),
  transfer("2", a, contract, "20", "wallet", "contract"),
  transfer("3", contract, c, "70", "contract", "wallet"),
];

test("computes totals, concentration, rankings, and activity breakdown", () => {
  const snapshot = buildIntelligenceSnapshot(transfers, 123);
  assert.equal(snapshot.generatedAt, 123);
  assert.equal(snapshot.totalVolume, 100);
  assert.equal(snapshot.transferCount, 3);
  assert.equal(snapshot.uniqueAddresses, 4);
  assert.equal(snapshot.activeContracts, 1);
  assert.equal(snapshot.concentration.largestTransferPercent, 70);
  assert.equal(snapshot.concentration.topThreePercent, 100);
  assert.equal(snapshot.topSenders[0].address, contract);
  assert.equal(snapshot.topReceivers[0].address, c);
  assert.equal(snapshot.activityBreakdown.find(item => item.category === "wallet-to-contract")?.count, 1);
});

test("handles empty and malformed non-finite values without fabricating activity", () => {
  const empty = buildIntelligenceSnapshot([], 0);
  assert.equal(empty.totalVolume, 0);
  assert.equal(empty.largestTransfer, null);
  assert.deepEqual(empty.signals, []);
  const malformed = buildIntelligenceSnapshot([transfer("4", a, b, "Infinity")], 0);
  assert.equal(malformed.totalVolume, 0);
  assert.equal(malformed.largestTransfer?.amount, 0);
});

test("deterministic ASK AERIS commands reference loaded identifiers only", () => {
  const snapshot = buildIntelligenceSnapshot(transfers, 0);
  const answer = answerDeterministically("show largest flows", snapshot, transfers);
  assert.equal(answer.intent.type, "highlight-transfers");
  assert.ok(answer.intent.transferIds.every(id => transfers.some(item => item.id === id)));
  const contracts = answerDeterministically("active contracts", snapshot, transfers);
  assert.equal(contracts.intent.type, "highlight-addresses");
  assert.deepEqual(contracts.intent.addresses, [contract]);
  assert.match(answerDeterministically("what happened last week?", snapshot, transfers).message, /Historical indexing is not available/);
});


test("connection failures preserve verified data as stale", () => {
  assert.equal(connectionAfterFailure(3), "stale");
  assert.equal(connectionAfterFailure(0), "unavailable");
});
