import test from "node:test";
import assert from "node:assert/strict";
import {validateCircleWallet} from "../src/circle/wallet-validation.ts";
import {circleReadConfigured, getCircleReadConfig} from "../src/circle/config.ts";
import {readVerifiedArcBalance} from "../src/circle/arc-wallet-read.ts";

const id = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const address = "0x1111111111111111111111111111111111111111";
const wallet = {id, address, blockchain: "EVM", custodyType: "DEVELOPER", accountType: "EOA", state: "LIVE"};

test("Arc balance is pinned to the verified current block, including a real zero balance", async () => {
  let readBlock;
  const result = await readVerifiedArcBalance({getChainId: async () => 5042, getBlock: async () => ({number: 123n, timestamp: 1000n}), readBalance: async block => {readBlock = block; return 0n;}, now: () => 1_001_000});
  assert.equal(readBlock, 123n);
  assert.deepEqual(result, {balance: 0n, blockNumber: 123n});
});

test("wrong network, stale head, future head and failed RPC never reach a balance read", async () => {
  for (const [chainId, block] of [[1, {number: 123n, timestamp: 1000n}], [5042, {number: null, timestamp: 1000n}], [5042, {number: 123n, timestamp: 800n}], [5042, {number: 123n, timestamp: 1040n}]]) {
    let reads = 0;
    await assert.rejects(readVerifiedArcBalance({getChainId: async () => chainId, getBlock: async () => block, readBalance: async () => {reads++; return 1n;}, now: () => 1_001_000}));
    assert.equal(reads, 0);
  }
  await assert.rejects(readVerifiedArcBalance({getChainId: async () => {throw new Error("RPC offline");}, getBlock: async () => ({number: 123n, timestamp: 1000n}), readBalance: async () => 1n}));
});

test("Circle identity must match the configured live developer-controlled wallet", () => {
  assert.equal(validateCircleWallet(wallet, id, address).address, address);
  for (const invalid of [null, {...wallet, id: "different"}, {...wallet, address: "0x2222222222222222222222222222222222222222"}, {...wallet, custodyType: "ENDUSER"}, {...wallet, accountType: "SCA"}, {...wallet, state: "FROZEN"}, {...wallet, blockchain: "EVM-TESTNET"}, {...wallet, blockchain: "ETH"}]) {
    assert.throws(() => validateCircleWallet(invalid, id, address));
  }
});

test("read-only Circle configuration does not require signing secrets", () => {
  const names = ["CIRCLE_API_KEY", "CIRCLE_EVM_WALLET_ID", "CIRCLE_EVM_WALLET_ADDRESS", "CIRCLE_ENTITY_SECRET"];
  const original = names.map(name => process.env[name]);
  try {
    names.forEach(name => delete process.env[name]);
    assert.equal(circleReadConfigured(), false);
    assert.throws(getCircleReadConfig);
    process.env.CIRCLE_API_KEY = "test-key";
    process.env.CIRCLE_EVM_WALLET_ID = id;
    process.env.CIRCLE_EVM_WALLET_ADDRESS = address;
    assert.equal(getCircleReadConfig().walletId, id);
    process.env.CIRCLE_EVM_WALLET_ID = "../other";
    assert.throws(getCircleReadConfig);
    process.env.CIRCLE_EVM_WALLET_ID = id;
    process.env.CIRCLE_EVM_WALLET_ADDRESS = "bad-address";
    assert.throws(getCircleReadConfig);
  } finally {
    names.forEach((name, index) => {if (original[index] === undefined) delete process.env[name]; else process.env[name] = original[index];});
  }
});
