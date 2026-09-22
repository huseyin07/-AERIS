import test from "node:test";
import assert from "node:assert/strict";
import {buildIntelligenceSnapshot} from "../src/intelligence/engine.ts";
import {answerDeterministically} from "../src/ai/deterministic.ts";
import {connectionAfterFailure} from "../src/state/connection.ts";
import {addressPosition, selectLabelCandidates, shortTransactionHash, significantTransferIds, transferIdentity, uniqueTransfers} from "../src/visualization/network-model.ts";

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

test("matches natural query variants and rejects unsupported scope", () => {
  const snapshot = buildIntelligenceSnapshot(transfers, 0);
  for (const query of ["Show me the largest transfer", "Largest flow", "Biggest transfer!"]) {
    assert.equal(answerDeterministically(query, snapshot, transfers).intent.type, "highlight-transfers");
  }
  for (const query of ["What contracts are active?", "Active contracts", "Top contracts"]) {
    assert.equal(answerDeterministically(query, snapshot, transfers).intent.type, "highlight-addresses");
  }
  assert.equal(answerDeterministically("Who is receiving the most USDC?", snapshot, transfers).intent.type, "highlight-addresses");
  assert.equal(answerDeterministically("Show wallet to contract activity", snapshot, transfers).intent.type, "highlight-transfers");
  assert.match(answerDeterministically("what is bitcoin's price?", snapshot, transfers).message, /live AERIS observation window/);
  assert.match(answerDeterministically("show 24h activity", snapshot, transfers).message, /live verified observation window/);
});

test("analyzes addresses only from the verified observation window", () => {
  const snapshot = buildIntelligenceSnapshot(transfers, 0);
  const known = answerDeterministically(`Explain ${contract}`, snapshot, transfers);
  assert.equal(known.intent.type, "focus-address-activity");
  assert.match(known.message, /contract.*2 transfers.*sending 70 USDC.*receiving 20 USDC.*2 unique counterparties.*70 USDC/i);
  const absent = answerDeterministically(`Explain ${address("9")}`, snapshot, transfers);
  assert.equal(absent.intent.type, "reset");
  assert.equal(absent.message, "This address is not present in the current verified observation window.");
});

test("network positions are stable across polling order and buffer growth", () => {
  const before = addressPosition(a);
  addressPosition(address("999"));
  assert.deepEqual(addressPosition(a), before);
  assert.notDeepEqual(addressPosition(a), addressPosition(b));
});

test("transfer visual identity and compact hash use verified fields", () => {
  const item = transfers[0];
  assert.equal(transferIdentity(item), `${item.txHash.toLowerCase()}:${item.logIndex}`);
  assert.equal(shortTransactionHash(item.txHash), `${item.txHash.slice(0, 6)}...${item.txHash.slice(-4)}`);
});

test("significant transfer ranking is relative and visual identities are unique", () => {
  assert.deepEqual(significantTransferIds(transfers, 2), [transferIdentity(transfers[2]), transferIdentity(transfers[1])]);
  assert.deepEqual(uniqueTransfers([...transfers, transfers[0]]).map(transferIdentity), transfers.map(transferIdentity));
});

test("label selection deduplicates identities and obeys its global maximum", () => {
  const candidates = [
    {id: "a", amount: 10, significant: true},
    {id: "a", amount: 10, significant: true},
    {id: "b", amount: 30, significant: true},
    {id: "c", amount: 20, significant: true},
  ];
  assert.deepEqual(selectLabelCandidates(candidates, {limit: 2}).map(item => item.id), ["b", "c"]);
  assert.equal(new Set(selectLabelCandidates(candidates, {limit: 3}).map(item => item.id)).size, 3);
});

test("selected and hovered labels displace lower-priority automatic labels", () => {
  const candidates = [
    {id: "largest", amount: 100, significant: true},
    {id: "agent", amount: 5, agentHighlighted: true},
    {id: "hovered", amount: 1},
    {id: "selected", amount: 0.5},
  ];
  assert.deepEqual(selectLabelCandidates(candidates, {selectedId: "selected", hoveredId: "hovered", limit: 3}).map(item => item.id), ["selected", "hovered", "agent"]);
  assert.deepEqual(selectLabelCandidates(candidates, {hoveredId: "hovered", limit: 1}).map(item => item.id), ["hovered"]);
});
