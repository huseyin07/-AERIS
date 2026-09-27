import test from "node:test";
import assert from "node:assert/strict";
import {createEntityClassifier} from "../src/data/entity-classifier.ts";

const address = suffix => `0x${suffix.padStart(40, "0")}`;

test("optional classification uses Arc Mainnet bytecode, caches successes, and leaves failures unknown", async () => {
  const calls = [];
  const classify = createEntityClassifier({
    getChainId: async () => 5042,
    getBytecode: async ({address: target}) => {calls.push(target); if (target === address("3")) throw new Error("RPC unavailable"); return target === address("2") ? "0x6000" : undefined;},
  });
  assert.deepEqual(await classify([address("1"), address("2"), address("3")]), {
    [address("1")]: "wallet", [address("2")]: "contract", [address("3")]: "unknown",
  });
  await classify([address("1"), address("2"), address("3")]);
  assert.deepEqual(calls, [address("1"), address("2"), address("3"), address("3")]);
});

test("wrong chain is rejected before bytecode lookup and each request stays bounded", async () => {
  let calls = 0;
  const classify = createEntityClassifier({getChainId: async () => 1, getBytecode: async () => {calls++; return undefined;}});
  await assert.rejects(classify([address("1")]), /Unexpected RPC chain/);
  await assert.rejects(classify(Array.from({length: 7}, (_, index) => address(String(index + 1)))), /Too many addresses/);
  assert.equal(calls, 0);
});

test("parallel clients share the optional RPC concurrency limit", async () => {
  let active = 0;
  let peak = 0;
  const classify = createEntityClassifier({
    getChainId: async () => 5042,
    getBytecode: async () => {active++; peak = Math.max(peak, active); await new Promise(resolve => setTimeout(resolve, 2)); active--; return undefined;},
  });
  await Promise.all([
    classify(Array.from({length: 6}, (_, index) => address(String(index + 1)))),
    classify(Array.from({length: 6}, (_, index) => address(String(index + 7)))),
  ]);
  assert.ok(peak <= 3);
});
