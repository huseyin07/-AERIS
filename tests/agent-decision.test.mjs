import test from "node:test";
import assert from "node:assert/strict";
import {proposeObservationAction, proposeSpendAction} from "../src/agent/decision-engine.ts";
import {DEFAULT_AGENT_POLICY} from "../src/agent/types.ts";

const snapshot = {generatedAt: 10, topFlows: [{id:"t1"}], entities:[{address:"0xabc"}]};

test("verified transfer evidence becomes a verified read-only action", () => {
  const action = proposeObservationAction({relatedTransferIds:["t1"],relatedAddresses:[]}, snapshot, DEFAULT_AGENT_POLICY);
  assert.equal(action.kind, "inspect-transfer");
  assert.equal(action.status, "verified");
  assert.equal(action.verification.verified, true);
});

test("missing evidence fails verification rather than inventing state", () => {
  const action = proposeObservationAction({relatedTransferIds:["missing"],relatedAddresses:[]}, snapshot, DEFAULT_AGENT_POLICY);
  assert.equal(action.status, "failed");
  assert.equal(action.verification.verified, false);
});

test("spend proposal never pretends execution happened", () => {
  const action = proposeSpendAction(0.1, DEFAULT_AGENT_POLICY, 0);
  assert.equal(action.status, "approval-required");
  assert.equal(action.verification.verified, false);
});

test("full observed transfer set verifies evidence outside ranked top flows",()=>{const action=proposeObservationAction({relatedTransferIds:["below-visual-threshold"],relatedAddresses:[]},snapshot,DEFAULT_AGENT_POLICY,0,new Set(["below-visual-threshold"]));assert.equal(action.status,"verified");assert.equal(action.verification.verified,true);});
