import test from "node:test";
import assert from "node:assert/strict";
import {createRun, evidenceStrength, planGoal, recoveryGate, shouldTriggerProactively} from "../src/agent/runtime.ts";

const signal={title:"LARGE FLOW",description:"Large verified flow",severity:"notable",importance:80,relatedTransferIds:["t1"],relatedAddresses:["0x1111111111111111111111111111111111111111"]};
const snapshot={generatedAt:200,transferCount:4,signals:[signal]};

test("goal planner produces auditable task sequence",()=>{const tasks=planGoal("monitor",100);assert.equal(tasks.length,7);assert.equal(tasks[0].status,"running");assert.equal(tasks[1].status,"pending");});
test("proactive trigger requires live complete changed material observation",()=>{
 assert.equal(shouldTriggerProactively({snapshot,connection:"stale",partial:false,lastRunAt:null,previousGeneratedAt:100,now:1000}).trigger,false);
 assert.equal(shouldTriggerProactively({snapshot,connection:"live",partial:true,lastRunAt:null,previousGeneratedAt:100,now:1000}).trigger,false);
 assert.equal(shouldTriggerProactively({snapshot,connection:"live",partial:false,lastRunAt:null,previousGeneratedAt:200,now:1000}).trigger,false);
 assert.equal(shouldTriggerProactively({snapshot,connection:"live",partial:false,lastRunAt:null,previousGeneratedAt:100,now:1000}).trigger,true);
});
test("cooldown prevents repeated autonomous investigations",()=>{assert.equal(shouldTriggerProactively({snapshot,connection:"live",partial:false,lastRunAt:950,previousGeneratedAt:100,now:1000}).trigger,false);});
test("evidence strength is based on concrete evidence count",()=>{const answer={evidence:[{transferId:"a",txHash:"0x1"},{transferId:"b",blockNumber:"2"},{transferId:"c",provenance:"arc"}]};assert.equal(evidenceStrength(answer).level,"high");});
test("recovery gate blocks economic action on partial observations",()=>{const action={status:"ready",policy:{reason:"ok"},verification:{message:"pending"}};assert.equal(recoveryGate("live",true,action).canAct,false);});

test("Sentinel does not repeat an already investigated signal",()=>{const first=shouldTriggerProactively({snapshot,connection:"live",partial:false,lastRunAt:null,lastSignature:null,previousGeneratedAt:100,now:1000});assert.equal(first.trigger,true);assert.equal(shouldTriggerProactively({snapshot:{...snapshot,generatedAt:300},connection:"live",partial:false,lastRunAt:null,lastSignature:first.signature,previousGeneratedAt:200,now:2000}).trigger,false);});

test("proactive run persists the exact Sentinel signature",()=>{const answer={evidence:[],summary:"x"};const action={kind:"focus-network",status:"verified",verification:{verified:true},policy:{},phases:[]};const run=createRun({goal:"g",trigger:"proactive",triggerReason:"human readable",triggerSignature:"stable-signal-id",answer,action,snapshot,now:1000});assert.equal(run.triggerSignature,"stable-signal-id");});
test("read-only verified run completes all lifecycle stages",()=>{const answer={evidence:[],summary:"x"};const action={kind:"focus-network",status:"verified",verification:{verified:true},policy:{},phases:[]};const run=createRun({goal:"g",trigger:"user",triggerReason:"q",answer,action,snapshot,now:1000});assert.equal(run.tasks.length,7);assert.ok(run.tasks.every(task=>task.status==="completed"));});
test("economic action awaiting execution never claims ACT or VERIFY completed",()=>{const answer={evidence:[],summary:"x"};const action={kind:"spend-usdc",status:"ready",verification:{verified:false},policy:{},phases:[]};const run=createRun({goal:"g",trigger:"user",triggerReason:"q",answer,action,snapshot,now:1000});assert.equal(run.tasks[4].status,"pending");assert.equal(run.tasks[5].status,"pending");assert.equal(run.tasks[6].status,"pending");});
