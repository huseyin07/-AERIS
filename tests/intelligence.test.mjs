import test from "node:test";
import assert from "node:assert/strict";
import {buildIntelligenceSnapshot} from "../src/intelligence/engine.ts";
import {answerDeterministically, withObservationStatus} from "../src/ai/deterministic.ts";
import {compareEntities, describeBehavior, diffSnapshots, planAgentQuery, traceObservedFlow} from "../src/ai/planner.ts";
import {connectionAfterFailure} from "../src/state/connection.ts";
import {addressPosition, reconcileIdentityOrder, selectLabelCandidates, shortTransactionHash, significantTransferIds, transferIdentity, uniqueTransfers} from "../src/visualization/network-model.ts";

const address = suffix => `0x${suffix.padStart(40, "0")}`;
const hash = suffix => `0x${suffix.padStart(64, "0")}`;
const transfer = (id, from, to, value, fromType = "wallet", toType = "wallet") => ({id, txHash: hash(id), blockNumber: "100", logIndex: Number(id), from, to, value, fromType, toType});
const a = address("1"), b = address("2"), c = address("3"), contract = address("4");
const transfers = [
  transfer("1", a, b, "10"),
  transfer("2", a, contract, "20", "wallet", "contract"),
  transfer("3", contract, c, "70", "contract", "wallet"),
];

test("reconciles visualization identities without moving surviving entities", () => {
  assert.deepEqual(reconcileIdentityOrder(["a", "b", "c"], ["b", "c", "d"]), ["b", "c", "d"]);
  assert.deepEqual(reconcileIdentityOrder(["b", "c", "d"], ["d", "b", "c", "e"]), ["b", "c", "d", "e"]);
});

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

test("derives complete entity intelligence from the verified window", () => {
  const snapshot = buildIntelligenceSnapshot(transfers, 0);
  const entity = snapshot.entities.find(item => item.address === contract);
  assert.equal(entity.sent, 70);
  assert.equal(entity.received, 20);
  assert.equal(entity.netFlow, -50);
  assert.equal(entity.transferCount, 2);
  assert.equal(entity.uniqueCounterparties, 2);
  assert.equal(entity.largestSent.amount, 70);
  assert.equal(entity.largestReceived.amount, 20);
  assert.match(entity.whyItMatters, /largest observed transfer/);
});

test("ranks and deduplicates at most three deterministic signals", () => {
  const first = buildIntelligenceSnapshot(transfers, 0).signals;
  const second = buildIntelligenceSnapshot(transfers, 999).signals;
  assert.ok(first.some(signal => signal.type === "large-flow"));
  assert.ok(first.some(signal => signal.type === "flow-concentration"));
  assert.ok(first.some(signal => signal.type === "contract-activity"));
  assert.ok(first.length <= 3);
  assert.equal(new Set(first.map(signal => signal.type)).size, first.length);
  assert.deepEqual(first.map(signal => signal.id), second.map(signal => signal.id));
  assert.ok(first.every((signal, index) => index === 0 || first[index - 1].importance >= signal.importance));
});

test("agent supports sender, receiver, counterparties, incoming, outgoing, and structured evidence", () => {
  const snapshot = buildIntelligenceSnapshot(transfers, 0);
  const queries = ["What's happening right now?", "Who is sending the most USDC?", "Who is receiving the most USDC?", "Which entity has the most counterparties?", "Show contract activity"];
  for (const query of queries) {
    const result = answerDeterministically(query, snapshot, transfers, contract);
    assert.ok(result.summary.length > 0);
    assert.ok(Array.isArray(result.evidence));
    if (result.intent.type === "highlight-transfers") assert.ok(result.intent.transferIds.every(id => transfers.some(item => item.id === id)));
    if (result.intent.type === "highlight-addresses") assert.ok(result.intent.addresses.every(id => snapshot.entities.some(item => item.address === id)));
  }
  assert.deepEqual(answerDeterministically("Show this address's incoming flows", snapshot, transfers, contract).relatedTransferIds, ["2"]);
  assert.deepEqual(answerDeterministically("Show this address's outgoing flows", snapshot, transfers, contract).relatedTransferIds, ["3"]);
});

test("agent performs multi-step largest-flow investigations with verified evidence", () => {
  const snapshot = buildIntelligenceSnapshot(transfers, 0);
  const result = answerDeterministically("Investigate the largest transfer", snapshot, transfers);
  assert.equal(result.intent.type, "highlight-transfers");
  assert.equal(result.relatedTransferIds[0], "3");
  assert.deepEqual(result.relatedAddresses, [contract, c]);
  assert.match(result.summary, /Investigation: 70 USDC moved/);
  assert.equal(result.evidence[0].txHash, transfers[2].txHash);
  assert.equal(result.evidence[0].blockNumber, transfers[2].blockNumber);
});

test("agent resolves follow-up pronouns from prior verified context", () => {
  const snapshot = buildIntelligenceSnapshot(transfers, 0);
  const received = answerDeterministically("What did it receive?", snapshot, transfers, null, {address: contract});
  assert.equal(received.intent.type, "highlight-transfers");
  assert.deepEqual(received.relatedTransferIds, ["2"]);
  const counterparties = answerDeterministically("Show its biggest counterparties", snapshot, transfers, null, {address: contract});
  assert.equal(counterparties.intent.type, "highlight-addresses");
  assert.equal(counterparties.relatedAddresses[0], contract);
  assert.ok(counterparties.evidence.some(item => item.address === a || item.address === c));
});

test("agent detects repeated directed flow patterns without identity inference", () => {
  const repeated = [transfers[0], {...transfers[0], id: "repeat-agent", txHash: hash("88"), logIndex: 88}, transfers[2]];
  const snapshot = buildIntelligenceSnapshot(repeated, 0);
  const result = answerDeterministically("Show repeated flow patterns", snapshot, repeated);
  assert.equal(result.intent.type, "highlight-transfers");
  assert.match(result.summary, /repeated directed flow pattern/i);
  assert.doesNotMatch(result.summary, /suspicious|whale|institution|exchange/i);
});

test("Agent V3 planner routes investigations, comparisons, traces, and changes deterministically", () => {
  assert.equal(planAgentQuery("Figure it out").intent, "investigate");
  assert.equal(planAgentQuery(`Compare ${a} vs ${b}`).intent, "compare");
  assert.equal(planAgentQuery("Trace this flow").intent, "trace");
  assert.equal(planAgentQuery("What changed?").intent, "changes");
});

test("Agent V3 compares verified entities and produces behavior fingerprints", () => {
  const snapshot = buildIntelligenceSnapshot(transfers, 0);
  const comparison = compareEntities(snapshot, a, contract);
  assert.equal(comparison.a.address, a);
  assert.equal(comparison.b.address, contract);
  assert.ok(Array.isArray(describeBehavior(comparison.a)));
  const answer = answerDeterministically(`Compare ${a} vs ${contract}`, snapshot, transfers);
  assert.equal(answer.intent.type, "highlight-addresses");
  assert.match(answer.summary, /net .* USDC/);
  assert.ok(answer.trace.toolsUsed.includes("entity-comparison"));
});

test("Agent V3 traces only observed-window transfer paths", () => {
  const chained = [
    {...transfers[0], blockNumber: "100"},
    {...transfers[2], from: b, to: c, blockNumber: "101"},
  ];
  const traced = traceObservedFlow(chained, chained[0].id);
  assert.deepEqual(traced.transferIds, ["1", "3"]);
  const snapshot = buildIntelligenceSnapshot(chained, 0);
  const answer = answerDeterministically("Trace this flow", snapshot, chained, null, {transferId: "1"});
  assert.equal(answer.intent.type, "highlight-transfers");
  assert.match(answer.summary, /not a claim about ultimate fund origin or destination/i);
});

test("Agent V3 reports snapshot changes without presenting window expiry as new chain facts", () => {
  const previous = buildIntelligenceSnapshot(transfers.slice(0, 2), 1);
  const current = buildIntelligenceSnapshot(transfers, 2);
  const delta = diffSnapshots(previous, current, transfers.slice(0, 2), transfers);
  assert.equal(delta.newTransferIds.length, 1);
  const answer = answerDeterministically("What changed?", current, transfers, null, {delta});
  assert.match(answer.summary, /Window expiry can also reduce these metrics/);
  assert.ok(answer.trace.toolsUsed.includes("snapshot-diff"));
});

test("Agent V3 autonomous investigation exposes analysis trace and verified identifiers", () => {
  const snapshot = buildIntelligenceSnapshot(transfers, 0);
  const answer = answerDeterministically("Something interesting seems to be happening. Figure it out.", snapshot, transfers);
  assert.ok(answer.trace.toolsUsed.length >= 4);
  assert.equal(answer.trace.transfersEvaluated, transfers.length);
  assert.ok(answer.relatedTransferIds.every(id => transfers.some(item => item.id === id)));
  assert.doesNotMatch(answer.summary, /whale|institution|suspicious|exchange/i);
});

test("status-aware answers never present stale or unavailable data as live", () => {
  const base = answerDeterministically("what's happening?", buildIntelligenceSnapshot(transfers, 0), transfers);
  assert.match(withObservationStatus(base, "stale").summary, /last successfully verified observation window/i);
  assert.match(withObservationStatus(base, "unavailable").summary, /unavailable/i);
  assert.equal(withObservationStatus(base, "unavailable").intent.type, "reset");
});

test("zero and small windows remain finite and preserve multi-log identities", () => {
  const empty = buildIntelligenceSnapshot([], 0);
  assert.equal(empty.entities.length, 0);
  assert.deepEqual(empty.signals, []);
  const one = buildIntelligenceSnapshot([transfers[0]], 0);
  assert.ok(Number.isFinite(one.concentration.topSenderPercent));
  assert.equal(one.entities.every(entity => entity.activityRank === null), true);
  const sameHash = [{...transfers[0], id: `${transfers[0].txHash}:0`, logIndex: 0}, {...transfers[0], id: `${transfers[0].txHash}:1`, logIndex: 1}];
  assert.equal(buildIntelligenceSnapshot(sameHash, 0).transferCount, 2);
  assert.equal(new Set(sameHash.map(transferIdentity)).size, 2);
});

import {AddressClassificationCache, BlockCursor, MAX_OBSERVED_EVENTS, OBSERVATION_WINDOW_MS, contractCallActivityId, deploymentActivityId, normalizeTransactionActivity, pruneObservation, receiptStatus, transferToActivity, transactionActivityId, usdcActivityId} from "../src/data/activity-engine.ts";
import {selectSignificantTransfers, VISUAL_CAPS} from "../src/visualization/network-model.ts";
import {healthLabel, newestTransfers, relativeActivityTime, searchObservation} from "../src/lib/activity-ui.ts";

const baseTx = (overrides = {}) => ({hash: hash("abc"), blockNumber: 10n, blockHash: hash("b10"), transactionIndex: 2, from: a, to: contract, input: "0x12345678", ...overrides});

test("activity identities are deterministic and preserve distinct USDC log children", () => {
  assert.equal(usdcActivityId(hash("a"), 4), usdcActivityId(hash("a"), 4));
  assert.notEqual(usdcActivityId(hash("a"), 4), usdcActivityId(hash("a"), 5));
  assert.match(transactionActivityId(hash("a")), /:tx:/);
  assert.match(contractCallActivityId(hash("a")), /:call:/);
  assert.match(deploymentActivityId(hash("a"), contract), /:deployment:/);
});

test("contract calls require confirmed contract classification and carry receipt status", () => {
  const context = {timestamp: 1_000, observedAt: 2_000};
  const call = normalizeTransactionActivity(baseTx(), {status: "success"}, "contract", context);
  assert.equal(call?.type, "CONTRACT_CALL");
  assert.equal(call?.inputSelector, "0x12345678");
  assert.equal(call?.parentTransactionId, transactionActivityId(baseTx().hash));
  assert.equal(normalizeTransactionActivity(baseTx(), {status: "success"}, "wallet", context), null);
  assert.equal(receiptStatus("reverted"), "failed");
  assert.equal(receiptStatus(undefined), "unknown");
});

test("only successful receipt-backed contract creations become deployments", () => {
  const tx = baseTx({to: null}); const context = {timestamp: 1_000, observedAt: 2_000};
  assert.equal(normalizeTransactionActivity(tx, {status: "reverted", contractAddress: contract}, "unknown", context), null);
  assert.equal(normalizeTransactionActivity(tx, {status: "success"}, "unknown", context), null);
  const deployment = normalizeTransactionActivity(tx, {status: "success", contractAddress: contract}, "unknown", context);
  assert.equal(deployment?.type, "CONTRACT_DEPLOYMENT");
  assert.equal(deployment?.to, contract);
});

test("observation window dedupes, expires by chain timestamp, and enforces 20k ceiling", () => {
  const now = 2_000_000;
  const make = (index, timestamp = now) => transferToActivity({...transfer(String(index), a, b, "1"), txHash: hash(String(index)), logIndex: index}, {blockHash: hash("beef"), transactionIndex: index, timestamp, observedAt: now});
  const duplicate = make(1);
  assert.equal(pruneObservation([duplicate, duplicate], now).length, 1);
  assert.equal(pruneObservation([make(2, now - OBSERVATION_WINDOW_MS - 1)], now).length, 0);
  const large = Array.from({length: MAX_OBSERVED_EVENTS + 7}, (_, index) => make(index));
  assert.equal(pruneObservation(large, now).length, MAX_OBSERVED_EVENTS);
});

test("incremental cursor rejects duplicate blocks but accepts recent reorg hash changes", () => {
  const cursor = new BlockCursor();
  assert.equal(cursor.shouldProcess(10n, hash("1")), true);
  cursor.record(10n, hash("1"));
  assert.equal(cursor.lastProcessedBlock, 10n);
  assert.equal(cursor.shouldProcess(10n, hash("1")), false);
  assert.equal(cursor.shouldProcess(10n, hash("2")), true);
});

test("bounded address cache normalizes keys and evicts least recently used entries", () => {
  const cache = new AddressClassificationCache(2);
  cache.set(a.toUpperCase(), "wallet"); cache.set(b, "contract");
  assert.equal(cache.get(a), "wallet");
  cache.set(c, "unknown");
  assert.equal(cache.get(b), undefined);
  assert.equal(cache.size, 2);
});

test("contract activity never double counts verified USDC economic volume", () => {
  const item = transfers[1];
  const moneyEvent = transferToActivity(item, {blockHash: hash("10"), transactionIndex: 0, timestamp: 1000, observedAt: 1000});
  const call = normalizeTransactionActivity(baseTx({hash: item.txHash}), {status: "success"}, "contract", {timestamp: 1000, observedAt: 1000});
  const snapshot = buildIntelligenceSnapshot([item], 1000, [moneyEvent, call]);
  assert.equal(snapshot.totalVolume, 20);
  assert.equal(snapshot.networkActivity.observedEvents, 2);
  assert.equal(snapshot.networkActivity.contractInteractions, 1);
  assert.equal(snapshot.networkActivity.observedTransactions, 1);
});

test("significance selection is deterministic, diverse, and visual caps match the observatory targets", () => {
  const crowded = Array.from({length: 20}, (_, index) => transfer(String(index + 10), a, b, String(1000 - index)));
  const diverse = Array.from({length: 10}, (_, index) => transfer(String(index + 50), address(String(index + 10)), address(String(index + 30)), String(100 - index)));
  const first = selectSignificantTransfers([...crowded, ...diverse], 10);
  assert.deepEqual(first, selectSignificantTransfers([...crowded, ...diverse], 10));
  assert.ok(first.some(item => item.from !== a));
  assert.deepEqual(VISUAL_CAPS, {desktop: {flows: 44, nodes: 84, labels: 3, annotations: 2}, tablet: {flows: 34, nodes: 84, labels: 2, annotations: 1}, mobile: {flows: 24, nodes: 56, labels: 1, annotations: 0}});
});

test("ledger derives verified transfers newest-first without mutating its source", () => {
  const source = [
    {...transfers[0], timestamp: 1_000, transactionIndex: 1},
    {...transfers[1], timestamp: 3_000, transactionIndex: 2},
    {...transfers[2], timestamp: 2_000, transactionIndex: 3},
  ];
  assert.deepEqual(newestTransfers(source).map(item => item.id), ["2", "3", "1"]);
  assert.deepEqual(source.map(item => item.id), ["1", "2", "3"]);
  assert.equal(newestTransfers([]).length, 0);
  assert.equal(relativeActivityTime(1_000, 39_000), "38s ago");
});

test("observation search validates exact addresses and hashes and clear restores the ledger", () => {
  const addressResult = searchObservation(transfers, [], a.toUpperCase());
  assert.equal(addressResult.kind, "address");
  assert.equal(addressResult.transfers.length, 2);
  const hashResult = searchObservation(transfers, [], transfers[1].txHash);
  assert.equal(hashResult.kind, "transaction");
  assert.deepEqual(hashResult.transfers.map(item => item.id), ["2"]);
  const invalid = searchObservation(transfers, [], "0x123");
  assert.equal(invalid.kind, "invalid");
  assert.equal(invalid.transfers.length, transfers.length);
  assert.equal(searchObservation(transfers, [], "").transfers.length, transfers.length);
});

test("health maps successful, partial, failed, and stale observations without erasing data", () => {
  const current = {status: "ok", rpcWarnings: [], lastSuccessfulAt: 100_000};
  assert.equal(healthLabel("live", current, 110_000), "LIVE");
  assert.equal(healthLabel("live", {...current, status: "partial", rpcWarnings: ["logs limited"]}, 110_000), "PARTIAL");
  assert.equal(healthLabel("stale", current, 110_000), "DEGRADED");
  assert.equal(healthLabel("live", current, 150_001), "DEGRADED");
  assert.equal(connectionAfterFailure(transfers.length), "stale");
});

test("signals detect repeated directed counterparties and verified deployments", () => {
  const repeated = [transfers[0], {...transfers[0], id: "repeat", txHash: hash("99"), logIndex: 99}, transfers[1]];
  const deployment = normalizeTransactionActivity(baseTx({to: null}), {status: "success", contractAddress: contract}, "unknown", {timestamp: 1_000, observedAt: 1_000});
  const repeatedSnapshot = buildIntelligenceSnapshot(repeated, 2_000);
  assert.ok(repeatedSnapshot.signals.some(signal => signal.type === "repeated-counterparty"));
  assert.ok(repeatedSnapshot.signals.some(signal => signal.type === "flow-concentration"));
  const deploymentSnapshot = buildIntelligenceSnapshot(transfers, 2_000, deployment ? [deployment] : []);
  assert.ok(deploymentSnapshot.signals.some(signal => signal.type === "new-contract-activity"));
});

test("agent transaction explanations use supplied verified data without identity claims", () => {
  const timed = transfers.map((item, index) => ({...item, timestamp: 10_000 - index * 1_000}));
  const snapshot = buildIntelligenceSnapshot(timed, 12_000);
  const largest = answerDeterministically("Largest flows", snapshot, timed);
  assert.match(largest.evidence[0].text, /USDC.*0x.*→.*ago/);
  const explanation = answerDeterministically(`Explain transaction ${timed[0].txHash}`, snapshot, timed);
  assert.match(explanation.summary, /USDC moved from.*block 100/);
  assert.doesNotMatch(explanation.summary, /whale|institution|suspicious|exchange/i);
});
