import test from "node:test";
import assert from "node:assert/strict";
import {evaluateSpendPolicy} from "../src/agent/policy.ts";
import {DEFAULT_AGENT_POLICY} from "../src/agent/types.ts";

test("policy blocks emergency-stop spending", () => {
  const decision = evaluateSpendPolicy({...DEFAULT_AGENT_POLICY, emergencyStop: true}, 0.1, 0);
  assert.equal(decision.allowed, false);
});

test("policy blocks per-action and daily budget overruns", () => {
  assert.equal(evaluateSpendPolicy({...DEFAULT_AGENT_POLICY, maxTransactionUsdc: 1}, 1.01, 0).allowed, false);
  assert.equal(evaluateSpendPolicy({...DEFAULT_AGENT_POLICY, dailyBudgetUsdc: 5}, 1, 4.5).allowed, false);
});

test("policy requires approval by default", () => {
  const decision = evaluateSpendPolicy(DEFAULT_AGENT_POLICY, 0.1, 0);
  assert.equal(decision.allowed, true);
  assert.equal(decision.requiresApproval, true);
});

test("policy permits autonomous spend only when explicitly enabled", () => {
  const policy = {...DEFAULT_AGENT_POLICY, autoExecute: true, requireApprovalAboveUsdc: 0.5};
  const decision = evaluateSpendPolicy(policy, 0.1, 0);
  assert.equal(decision.allowed, true);
  assert.equal(decision.requiresApproval, false);
});
