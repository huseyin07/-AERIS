import test from 'node:test';
import assert from 'node:assert/strict';
import {encodeEventTopics,encodeAbiParameters,erc20Abi} from 'viem';
import {mergeObservations,activityTotals} from '../src/activity/history.ts';
import {usdcReceiptTransfers} from '../src/activity/receipt.ts';
import {ARC} from '../src/data/arc.ts';
const a='0x'+'1'.repeat(40),b='0x'+'2'.repeat(40),hash='0x'+'a'.repeat(64);
const transfer=(extra={})=>({id:hash+':0',txHash:hash,logIndex:0,from:a,to:b,value:'10.000001',blockNumber:'100',timestamp:1500,fromType:'wallet',toType:'wallet',...extra});
const observation=(extra={})=>({version:1,chainId:5042,from:1000,to:2000,capturedAt:2100,complete:true,transfers:[transfer()],...extra});
test('overlapping snapshots preserve individual logs and newer evidence',()=>{
 const r=mergeObservations([observation(),observation({capturedAt:2200,transfers:[transfer({value:'11'}),transfer({logIndex:1,value:'3'})]})],a,1000,3000);
 assert.equal(r.transfers.length,2);assert.equal(r.transfers.find(t=>t.logIndex===0).value,'11');assert.deepEqual(r.coverage,[{from:1000,to:2000}]);
});
test('missing intervals and incomplete captures are never claimed complete',()=>{
 const r=mergeObservations([observation(),observation({from:2500,to:2900,complete:false}),observation({from:3000,to:4000})],a,500,4500);
 assert.deepEqual(r.coverage,[{from:1000,to:2000},{from:3000,to:4000}]);
});
test('address and range filtering cannot include unrelated funds',()=>{
 const r=mergeObservations([observation({transfers:[transfer({from:b,to:b}),transfer({timestamp:900}),transfer({logIndex:2})]})],a,1000,2000);
 assert.equal(r.transfers.length,1);assert.equal(r.transfers[0].logIndex,2);
});
test('totals retain six decimals, huge amounts and self-transfer neutrality',()=>{
 const r=activityTotals([transfer({value:'999999999999999.000001'}),transfer({from:b,to:a,value:'0.000002'}),transfer({from:a,to:a,value:'5'})],a);
 assert.equal(r.sent,999999999999999000001n+5000000n);assert.equal(r.received,5000002n);assert.equal(r.net,-999999999999998999999n);
});
test('receipt parsing accepts native USDC logs and rejects other tokens or malformed events',()=>{
 const log={address:ARC.usdc,topics:encodeEventTopics({abi:erc20Abi,eventName:'Transfer',args:{from:a,to:b}}),data:encodeAbiParameters([{type:'uint256'}],[10000001n]),logIndex:4};
 const events=usdcReceiptTransfers([log,{...log,address:a},{...log,data:'0x'}]);
 assert.deepEqual(events,[{from:a,to:b,amountUsdc:'10.000001',logIndex:4}]);
});

import {boundedLogs} from '../src/activity/log-ranges.ts';
test('RPC result limits split into contiguous ranges without losing events',async()=>{
 const seen=[];
 const values=await boundedLogs(async(from,to)=>{
  if(to-from>63n){const error=new Error('limit');error.name='LimitExceededRpcError';throw error;}
  seen.push([from,to]);return Array.from({length:Number(to-from+1n)},(_,i)=>from+BigInt(i));
 },0n,255n);
 assert.deepEqual(seen,[[0n,63n],[64n,127n],[128n,191n],[192n,255n]]);
 assert.equal(values.length,256);assert.equal(new Set(values).size,256);
});
test('unrelated RPC failures are never converted into an empty history',async()=>{
 let calls=0;await assert.rejects(()=>boundedLogs(async()=>{calls++;throw Error('offline');},0n,1000n),/offline/);assert.equal(calls,1);
});
test('limits in the smallest supported range remain explicit failures',async()=>{
 const error=new Error('limit');error.name='LimitExceededRpcError';
 await assert.rejects(()=>boundedLogs(async()=>{throw error;},0n,63n),/limit/);
});
