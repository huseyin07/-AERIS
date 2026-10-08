import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyWatchState, evaluateWatchlist, parseUsdc, restoreWatchState} from '../src/watchlist/engine.ts';

const address = '0x' + 'a'.repeat(40);
const recipient = n => '0x' + String(n).padStart(40, '0');
const ref = 1_800_000_000_000;
const transfer = (n, value = '100', timestamp = ref) => ({id:String(n), txHash:'0x'+String(n).padStart(64,'0'),blockNumber:String(n),logIndex:0,timestamp,from:address,to:recipient(n),value,fromType:'unknown',toType:'unknown'});
const initial = (rules = {}) => ({...emptyWatchState(),watches:[{id:'watch',address,label:'Treasury',enabled:true,largeOutflow:'10000',newRecipientCount:2,lastReference:null,recipients:[],recipientLimit:false,discoveries:[],seenLarge:[],burstActive:false,...rules}]});

test('USDC thresholds use exact six-decimal amounts', () => {
  assert.equal(parseUsdc('0.000001'), 1n);
  assert.equal(parseUsdc('10000.000001'),10000000001n);
  for (const v of ['0','-1','1e4','1.0000001','NaN','']) assert.equal(parseUsdc(v),null);
  const state=evaluateWatchlist(initial({largeOutflow:'10000.000001'}),[transfer(1,'10000'),transfer(2,'10000.000001')],ref,true);
  assert.equal(state.alerts.length,1); assert.equal(state.alerts[0].evidence[0].value,'10000.000001');
});
test('large alerts include initial matches, deduplicate logs and repeated polling', () => {
  const t=transfer(1,'20000');
  const first=evaluateWatchlist(initial(),[t,t],ref,true);
  assert.equal(first.alerts[0].count,1);
  const second=evaluateWatchlist(first,[t],ref+10_000,true);
  assert.equal(second.alerts.length,1);
  const sameTimestamp=evaluateWatchlist(first,[t,{...transfer(2,'30000'),timestamp:ref}],ref,true);
  assert.equal(sameTimestamp.alerts.length,2);
});
test('incoming, self and outside-window transfers do not trigger outflow rules', () => {
  const samples=[{...transfer(1,'20000'),from:recipient(1),to:address},{...transfer(2,'20000'),to:address},transfer(3,'20000',ref-600_000),transfer(4,'20000',ref+1)];
  assert.equal(evaluateWatchlist(initial(),samples,ref,true).alerts.length,0);
});
test('incomplete/stale observations and paused rules cannot advance a baseline', () => {
  const s=initial(); assert.equal(evaluateWatchlist(s,[transfer(1,'20000')],ref,false),s);
  const p=initial({enabled:false});assert.equal(evaluateWatchlist(p,[transfer(1,'20000')],ref,true),p);
});
test('new recipients learn a baseline then count distinct addresses, including sub-$1000 flows', () => {
  const baseline=evaluateWatchlist(initial(),[transfer(1)],ref,true);
  assert.equal(baseline.alerts.length,0);
  const t2=transfer(2,'0.01',ref+10_000),t3=transfer(3,'20',ref+20_000);
  const state=evaluateWatchlist(baseline,[transfer(1),t2,{...t2,logIndex:1},t3],ref+20_000,true);
  assert.equal(state.alerts.length,1);assert.equal(state.alerts[0].kind,'new-recipients');assert.equal(state.alerts[0].count,2);
  assert.equal(evaluateWatchlist(state,[t2,t3],ref+30_000,true).alerts.length,1);
});
test('a monitoring gap re-seeds recipients without inventing background alerts', () => {
  const baseline=evaluateWatchlist(initial(),[transfer(1)],ref,true);
  const gap=evaluateWatchlist(baseline,[transfer(2,'1',ref+180_000),transfer(3,'1',ref+180_000)],ref+180_000,true);
  assert.equal(gap.alerts.length,0);assert.equal(gap.watches[0].discoveries.length,0);
});
test('rolling recipient alerts re-arm only after the condition falls below threshold', () => {
  let s=evaluateWatchlist(initial(),[],ref,true);
  s=evaluateWatchlist(s,[transfer(1),transfer(2)],ref+1,true);
  assert.equal(s.alerts.length,1);
  for(let time=ref+60_000;time<=ref+660_000;time+=60_000)s=evaluateWatchlist(s,[],time,true);
  assert.equal(s.watches[0].burstActive,false);
  s=evaluateWatchlist(s,[transfer(3,'1',ref+670_000),transfer(4,'1',ref+670_000)],ref+670_000,true);
  assert.equal(s.alerts.length,2);
});
test('storage validates rules, addresses and evidence; round trip preserves deduplication', () => {
  for(const raw of ['not json','null','{}'])assert.deepEqual(restoreWatchState(raw),emptyWatchState());
  const s=evaluateWatchlist(initial(),[transfer(1,'20000')],ref,true);
  const restored=restoreWatchState(JSON.stringify(s)); assert.equal(restored.alerts.length,1);
  assert.equal(evaluateWatchlist(restored,[transfer(1,'20000')],ref+1,true).alerts.length,1);
  assert.equal(restoreWatchState(JSON.stringify({...s,watches:[{...s.watches[0],largeOutflow:'-1'}]})).watches.length,0);
  assert.equal(restoreWatchState(JSON.stringify({...s,alerts:[{...s.alerts[0],evidence:[{...transfer(1),txHash:'javascript:bad'}]}]})).alerts.length,0);
});
