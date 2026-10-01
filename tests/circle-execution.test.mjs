import test from "node:test";
import assert from "node:assert/strict";
import {authorizeCircleExecution} from "../src/circle/execution-gate.ts";
import {DEFAULT_AGENT_POLICY} from "../src/agent/types.ts";

test("Circle execution is disabled by default",()=>{delete process.env.AERIS_CIRCLE_EXECUTION_ENABLED;assert.equal(authorizeCircleExecution({policy:DEFAULT_AGENT_POLICY,amountUsdc:.1,spentTodayUsdc:0,live:true,partial:false,requestKey:"r1"}).allowed,false);});
test("partial Arc observation blocks execution even with feature enabled",()=>{process.env.AERIS_CIRCLE_EXECUTION_ENABLED="true";const policy={...DEFAULT_AGENT_POLICY,autoExecute:true,requireApprovalAboveUsdc:1};assert.equal(authorizeCircleExecution({policy,amountUsdc:.1,spentTodayUsdc:0,live:true,partial:true,requestKey:"r1"}).allowed,false);});
test("approval-gated policy cannot reach Circle signer",()=>{process.env.AERIS_CIRCLE_EXECUTION_ENABLED="true";assert.equal(authorizeCircleExecution({policy:DEFAULT_AGENT_POLICY,amountUsdc:.1,spentTodayUsdc:0,live:true,partial:false,requestKey:"r1"}).allowed,false);});
