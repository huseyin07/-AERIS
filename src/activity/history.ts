import type {Transfer} from "../data/types";
export type Observation = {version: 1; chainId: 5042; from: number; to: number; capturedAt: number; complete: boolean; transfers: Transfer[]};
export function mergeObservations(observations: Observation[], address: string, since: number, until: number) {
  const entries = new Map<string, Transfer>();
  const intervals: {from: number; to: number}[] = [];
  for (const observation of [...observations].sort((a,b) => a.capturedAt-b.capturedAt)) {
    if (observation.chainId !== 5042 || observation.to < since || observation.from > until) continue;
    if (observation.complete) intervals.push({from: Math.max(since, observation.from), to: Math.min(until, observation.to)});
    for (const t of observation.transfers) if (t.timestamp !== undefined && t.timestamp >= since && t.timestamp <= until && (t.from.toLowerCase() === address || t.to.toLowerCase() === address)) entries.set(`${t.txHash.toLowerCase()}:${t.logIndex}`,t);
  }
  const coverage: {from:number;to:number}[] = [];
  for (const interval of intervals.sort((a,b)=>a.from-b.from)) {
    const last = coverage.at(-1);
    if (last && interval.from <= last.to) last.to = Math.max(last.to,interval.to);
    else coverage.push({...interval});
  }
  return {transfers:[...entries.values()].sort((a,b)=>b.timestamp!-a.timestamp! || Number(BigInt(b.blockNumber)-BigInt(a.blockNumber)) || b.logIndex-a.logIndex),coverage};
}
export function activityTotals(transfers: readonly Transfer[], address: string) {
  let sent=0n, received=0n;
  const peers=new Map<string,{sent:bigint;received:bigint;count:number}>();
  for(const t of transfers){
    const [whole,fraction=""]=t.value.split(".");
    if(!/^\d+$/.test(whole)||!/^\d{0,6}$/.test(fraction))continue;
    const amount=BigInt(whole)*1_000_000n+BigInt(fraction.padEnd(6,"0"));
    const outgoing=t.from.toLowerCase()===address,incoming=t.to.toLowerCase()===address;
    if(!outgoing&&!incoming)continue;
    if(outgoing)sent+=amount;if(incoming)received+=amount;
    const peer=outgoing?t.to.toLowerCase():t.from.toLowerCase();
    const entry=peers.get(peer)??{sent:0n,received:0n,count:0};
    if(outgoing)entry.sent+=amount;if(incoming)entry.received+=amount;entry.count++;peers.set(peer,entry);
  }
  return {sent,received,net:received-sent,peers:[...peers].sort((a,b)=>a[1].sent+a[1].received>b[1].sent+b[1].received?-1:1)};
}
