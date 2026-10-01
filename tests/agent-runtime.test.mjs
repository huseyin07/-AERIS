import test from "node:test";
import assert from "node:assert/strict";
import {evidenceStrength, planGoal, recoveryGate, shouldTriggerProactively} from "../src/agent/runtime.ts";

const signal={title:"LARGE FLOW",description:"Large verified flow",severity:"notable",importance:80};
const snapshot={generatedAt:200,transferCount:4,signals:[signal]};

test("goal planner produces auditable task sequence",()=>{const tasks=planGoal("monitor",100);assert.equal(tasks.length,6);assert.equal(tasks[0].status,"running");assert.equal(tasks[1].status,"pending");});
test("proactive trigger requires live complete changed material observation",()=>{
 assert.equal(shouldTriggerProactively({snapshot,connection:"stale",partial:false,lastRunAt:null,previousGeneratedAt:100,now:1000}).trigger,false);
 assert.equal(shouldTriggerProactively({snapshot,connection:"live",partial:true,lastRunAt:null,previousGeneratedAt:100,now:1000}).trigger,false);
 assert.equal(shouldTriggerProactively({snapshot,connection:"live",partial:false,lastRunAt:null,previousGeneratedAt:200,now:1000}).trigger,false);
 assert.equal(shouldTriggerProactively({snapshot,connection:"live",partial:false,lastRunAt:null,previousGeneratedAt:100,now:1000}).trigger,true);
});
test("cooldown prevents repeated autonomous investigations",()=>{assert.equal(shouldTriggerProactively({snapshot,connection:"live",partial:false,lastRunAt:950,previousGeneratedAt:100,now:1000}).trigger,false);});
test("evidence strength is based on concrete evidence count",()=>{const answer={evidence:[{transferId:"a",txHash:"0x1"},{transferId:"b",blockNumber:"2"},{transferId:"c",provenance:"arc"}]};assert.equal(evidenceStrength(answer).level,"high");});
test("recovery gate blocks economic action on partial observations",()=>{const action={status:"ready",policy:{reason:"ok"},verification:{message:"pending"}};assert.equal(recoveryGate("live",true,action).canAct,false);});
