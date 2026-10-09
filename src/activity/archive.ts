import {get, put, list, del} from "@vercel/blob";
import {gzipSync, gunzipSync} from "node:zlib";
import {getRecentActivity} from "@/data/arc-source";
import {eventsToTransfers} from "@/data/activity-engine";
import {mergeObservations, type Observation} from "./history";
const PREFIX="arc-history/v1/";
const RETENTION=7*86400_000;
export const archiveConfigured=()=>Boolean(process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID);
export async function captureObservation(){
  if(!archiveConfigured())throw Error("Archive storage unavailable");
  const data=await getRecentActivity();
  const d=data.diagnostics;
  if(!d.windowCovered||d.headStale||d.headFutureSkewed||d.status!=="ok"||!d.windowReferenceTimestamp||!d.windowStartTimestamp)throw Error("Only complete fresh observations can enter the archive");
  const observation:Observation={version:1,chainId:5042,from:d.windowStartTimestamp,to:d.windowReferenceTimestamp,capturedAt:Date.now(),complete:true,transfers:eventsToTransfers(data.events)};
  // Immutable snapshots avoid last-writer-wins losses between concurrent collectors.
  const pathname=`${PREFIX}${String(Math.floor(observation.to/300_000)*300_000)}.json.gz`;
  try {await put(pathname,gzipSync(JSON.stringify(observation)),{access:"private",addRandomSuffix:false,contentType:"application/gzip",allowOverwrite:false});}
  catch(e){const existing=await get(pathname,{access:"private"});if(!existing||existing.statusCode!==200)throw e;}
  const old=await archiveManifest(true);
  const expired=old.filter(b=>Number(b.pathname.slice(PREFIX.length).split(".")[0])<Date.now()-RETENTION).map(b=>b.url);
  if(expired.length)await del(expired);
  return {to:observation.to,transfers:observation.transfers.length,retentionDays:7};
}
let manifest: {until:number; blobs: {pathname:string;url:string}[]} | null=null;
async function archiveManifest(refresh=false){
  if(!refresh&&manifest&&manifest.until>Date.now())return manifest.blobs;
  const blobs:{pathname:string;url:string}[]=[];let cursor:string|undefined;
  do {const page=await list({prefix:PREFIX,limit:1000,cursor});blobs.push(...page.blobs);cursor=page.hasMore?page.cursor:undefined;} while(cursor);
  manifest={until:Date.now()+60000,blobs};return blobs;
}
const cache=new Map<string,{until:number;promise:Promise<Observation|null>}>();
function readSnapshot(pathname:string){
  const saved=cache.get(pathname);if(saved&&saved.until>Date.now())return saved.promise;
  const promise=(async()=>{const result=await get(pathname,{access:"private"});if(!result||result.statusCode!==200)return null;
    const bytes=await new Response(result.stream).arrayBuffer();return JSON.parse(gunzipSync(Buffer.from(bytes)).toString()) as Observation;})();
  if(cache.size>400)cache.delete(cache.keys().next().value!);
  cache.set(pathname,{until:Date.now()+60_000,promise});promise.catch(()=>cache.delete(pathname));return promise;
}
export async function readAddressHistory(address:string,since:number,until:number,cursor?:string){
  const blobs=await archiveManifest();
  const candidates=blobs.filter(b=>{const bucket=Number(b.pathname.slice(PREFIX.length).split(".")[0]);return bucket+300_000>=since&&bucket-600_000<=until&&(!cursor||b.pathname<cursor);}).sort((a,b)=>b.pathname.localeCompare(a.pathname));
  const chosen=candidates.slice(0,12), observations:Observation[]=[];
  for(let i=0;i<chosen.length;i+=4){const batch=await Promise.all(chosen.slice(i,i+4).map(b=>readSnapshot(b.pathname)));observations.push(...batch.filter((o):o is Observation=>o!==null));}
  return {...mergeObservations(observations,address,since,until),nextCursor:candidates.length>12?chosen.at(-1)!.pathname:null,retentionDays:7};
}
