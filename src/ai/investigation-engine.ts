import type {Transfer} from "@/data/types";
import type {IntelligenceSnapshot} from "@/intelligence/types";

export type GraphInvestigation = {root: string; addresses: string[]; transferIds: string[]; hops: number; fanIn: number; fanOut: number};
export type AnomalyFinding = {transferId: string; percentile: number; medianMultiple: number; volumeShare: number; reason: string};
export type TemporalFinding = {currentCount: number; previousCount: number; countChangePercent: number | null; currentVolume: number; previousVolume: number; volumeChangePercent: number | null};
export type Provenance = {network: "Arc Mainnet"; blockNumber: string; txHash: string; logIndex: number; eventId: string};

const median = (values: number[]) => { if (!values.length) return 0; const sorted=[...values].sort((a,b)=>a-b); const mid=Math.floor(sorted.length/2); return sorted.length%2 ? sorted[mid] : (sorted[mid-1]+sorted[mid])/2; };
const pct = (value:number, base:number) => base === 0 ? null : (value-base)/base*100;

export function investigateGraph(transfers: readonly Transfer[], root: string, maxHops=2): GraphInvestigation {
  const rootKey=root.toLowerCase(); const seen=new Set([rootKey]); const addresses=[root]; const ids:string[]=[]; let frontier=new Set([rootKey]);
  for(let hop=0; hop<Math.max(1,Math.min(maxHops,3)); hop++){
    const next=new Set<string>();
    for(const item of transfers){
      const from=item.from.toLowerCase(), to=item.to.toLowerCase();
      if(!frontier.has(from) && !frontier.has(to)) continue;
      if(!ids.includes(item.id)) ids.push(item.id);
      for(const address of [item.from,item.to]){const key=address.toLowerCase(); if(!seen.has(key)){seen.add(key); addresses.push(address); next.add(key);}}
    }
    frontier=next; if(!frontier.size) break;
  }
  const fanIn=new Set(transfers.filter(item=>item.to.toLowerCase()===rootKey).map(item=>item.from.toLowerCase())).size;
  const fanOut=new Set(transfers.filter(item=>item.from.toLowerCase()===rootKey).map(item=>item.to.toLowerCase())).size;
  return {root,addresses,transferIds:ids,hops:maxHops,fanIn,fanOut};
}

export function detectTransferAnomalies(transfers: readonly Transfer[], totalVolume:number): AnomalyFinding[] {
  const amounts=transfers.map(item=>Number(item.value)).filter(Number.isFinite); const med=median(amounts);
  return transfers.map(item=>{const amount=Number(item.value); const rank=amounts.filter(value=>value<=amount).length; const percentile=amounts.length ? rank/amounts.length*100 : 0; const medianMultiple=med>0?amount/med:0; const volumeShare=totalVolume>0?amount/totalVolume*100:0; return {transferId:item.id,percentile,medianMultiple,volumeShare,reason:`${percentile.toFixed(1)}th percentile by size · ${medianMultiple.toFixed(1)}× median · ${volumeShare.toFixed(1)}% of observed volume`};}).filter(item=>item.percentile>=95 || item.medianMultiple>=5 || item.volumeShare>=20).sort((a,b)=>b.percentile-a.percentile||b.volumeShare-a.volumeShare).slice(0,8);
}

export function compareTemporalHalves(transfers: readonly Transfer[]): TemporalFinding | null {
  const timed=transfers.filter(item=>typeof item.timestamp==="number").sort((a,b)=>(a.timestamp??0)-(b.timestamp??0)); if(timed.length<2) return null;
  const min=timed[0].timestamp!, max=timed[timed.length-1].timestamp!; const split=min+(max-min)/2;
  const previous=timed.filter(item=>item.timestamp!<split), current=timed.filter(item=>item.timestamp!>=split);
  const previousVolume=previous.reduce((sum,item)=>sum+Number(item.value),0), currentVolume=current.reduce((sum,item)=>sum+Number(item.value),0);
  return {currentCount:current.length,previousCount:previous.length,countChangePercent:pct(current.length,previous.length),currentVolume,previousVolume,volumeChangePercent:pct(currentVolume,previousVolume)};
}

export function concentrationSummary(snapshot:IntelligenceSnapshot){
  return {largestFlowPercent:snapshot.concentration.largestTransferPercent,topThreePercent:snapshot.concentration.topThreePercent,topSenderPercent:snapshot.concentration.topSenderPercent,topReceiverPercent:snapshot.concentration.topReceiverPercent};
}

export function provenanceFor(transfers: readonly Transfer[], ids: readonly string[]): Provenance[] {
  return ids.map(id=>transfers.find(item=>item.id===id)).filter((item): item is Transfer=>Boolean(item)).map(item=>({network:"Arc Mainnet",blockNumber:item.blockNumber,txHash:item.txHash,logIndex:item.logIndex,eventId:item.id}));
}

export function verifyAgentEvidence(transfers: readonly Transfer[], addresses: readonly string[], transferIds: readonly string[]) {
  const knownIds=new Set(transfers.map(item=>item.id)); const knownAddresses=new Set(transfers.flatMap(item=>[item.from.toLowerCase(),item.to.toLowerCase()]));
  const verifiedTransferIds=transferIds.filter(id=>knownIds.has(id)); const verifiedAddresses=addresses.filter(address=>knownAddresses.has(address.toLowerCase()));
  return {verified:verifiedTransferIds.length===transferIds.length&&verifiedAddresses.length===addresses.length,verifiedTransferIds,verifiedAddresses};
}
