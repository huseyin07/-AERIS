import {get,put} from "@vercel/blob";
import {gzipSync,gunzipSync} from "node:zlib";
import {createPublicClient,http,erc20Abi} from "viem";
import {ARC,arcChain} from "@/data/arc";
import {normalizeTransfer} from "@/data/normalize";
import type {Transfer} from "@/data/types";
type StoredPage={version:1;chainId:5042;fromBlock:string;toBlock:string;fromTime:number;toTime:number;fromHash:string;toHash:string;transfers:Transfer[];nextOffset:number|null;capturedAt:number;cacheHit?:boolean};
const inFlight=new Map<string,Promise<StoredPage>>();
export async function addressHistory(address:`0x${string}`,since:number,until:number,cursor?:string){
 const rpc=createPublicClient({chain:arcChain,transport:http(ARC.rpcUrl,{timeout:8000,retryCount:0,fetchOptions:{cache:"no-store"}})});
 const [chain,head]=await Promise.all([rpc.getChainId(),rpc.getBlock()]);
 const age=Date.now()-Number(head.timestamp)*1000;
 if(chain!==5042||head.number===null||age>120000||age< -30000)throw Error("Arc head unavailable");
 let to=head.number-1n,offset=0;
 if(cursor){const parts=cursor.split(":");to=BigInt(parts[0]);offset=Number(parts[1]);if(to>=head.number||to<0n)throw Error("Invalid cursor");}
 const from=to>=4095n?to-4095n:0n;
 const [fromHeader,toHeader]=await Promise.all([rpc.getBlock({blockNumber:from}),rpc.getBlock({blockNumber:to})]);
 if(!fromHeader.hash||!toHeader.hash)throw Error("Missing block identity");
 if(Number(toHeader.timestamp)*1000<since)return {transfers:[],coverage:[],nextCursor:null,retentionDays:7};
 // A cursor cannot cause scans outside the requested time window.
 if(cursor&&Number(fromHeader.timestamp)*1000>until)throw Error("Cursor is outside the requested range");
 const key=`arc-address/v1/${address}/${from}-${to}-${offset}.json.gz`;
 if(!inFlight.has(key))inFlight.set(key,(async()=>{
   const saved=await get(key,{access:"private"});
   if(saved?.statusCode===200){const page=JSON.parse(gunzipSync(Buffer.from(await new Response(saved.stream).arrayBuffer())).toString()) as StoredPage;
     if(page.chainId===5042&&page.fromHash===fromHeader.hash&&page.toHash===toHeader.hash)return {...page,cacheHit:true};
   }
   const [outgoing,incoming]=await Promise.all([
     rpc.getContractEvents({address:ARC.usdc,abi:erc20Abi,eventName:"Transfer",args:{from:address},fromBlock:from,toBlock:to,strict:true}),
     rpc.getContractEvents({address:ARC.usdc,abi:erc20Abi,eventName:"Transfer",args:{to:address},fromBlock:from,toBlock:to,strict:true})
   ]);
   const logs=[...new Map([...outgoing,...incoming].map(log=>[`${log.transactionHash}:${log.logIndex}`,log])).values()].sort((a,b)=>Number(b.blockNumber!-a.blockNumber!)||b.logIndex!-a.logIndex!);
   if(logs.length>50000||offset>logs.length)throw Error("Address range is too dense or cursor invalid");
   const chosen=logs.slice(offset,offset+200),headers=new Map<string,typeof fromHeader>([[from.toString(),fromHeader],[to.toString(),toHeader]]);
   const blocks=[...new Set(chosen.map(l=>l.blockNumber!.toString()))].filter(n=>!headers.has(n));
   for(let i=0;i<blocks.length;i+=4)await Promise.all(blocks.slice(i,i+4).map(async n=>headers.set(n,await rpc.getBlock({blockNumber:BigInt(n)}))));
   const transfers=chosen.map(log=>{const block=headers.get(log.blockNumber!.toString())!;if(log.blockHash!==block.hash)throw Error("Block changed during history lookup");const t=normalizeTransfer(log);if(!t)throw Error("Malformed transfer evidence");return {...t,timestamp:Number(block.timestamp)*1000};});
   const current=await rpc.getBlock({blockNumber:to});if(current.hash!==toHeader.hash)throw Error("History changed during lookup");
   const page:StoredPage={version:1,chainId:5042,fromBlock:from.toString(),toBlock:to.toString(),fromTime:Number(fromHeader.timestamp)*1000,toTime:Number(toHeader.timestamp)*1000,fromHash:fromHeader.hash!,toHash:toHeader.hash!,transfers,nextOffset:offset+200<logs.length?offset+200:null,capturedAt:Date.now()};
   // Canonical block hash is part of the record; reorgs replace the cached page.
   await put(key,gzipSync(JSON.stringify(page)),{access:"private",contentType:"application/gzip",addRandomSuffix:false,allowOverwrite:true});
   return page;
 })().finally(()=>inFlight.delete(key)));
 const page=await inFlight.get(key)!;
 return {transfers:page.transfers.filter(t=>t.timestamp!>=since&&t.timestamp!<=until),coverage:offset===0&&page.nextOffset===null?[{from:Math.max(since,page.fromTime),to:Math.min(until,page.toTime)}].filter(c=>c.to>=c.from):[],
   nextCursor:page.nextOffset!==null?`${to}:${page.nextOffset}`:from>0n&&page.fromTime>since?`${from-1n}:0`:null,retentionDays:7,source:"arc-rpc-and-persistent-cache",cacheHit:page.cacheHit===true,fromBlock:page.fromBlock,toBlock:page.toBlock,partialPage:offset>0||page.nextOffset!==null};
}
