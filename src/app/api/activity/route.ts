import {NextResponse,after} from "next/server";
import {archiveConfigured,captureObservation} from "@/activity/archive";
import {ARC} from "@/data/arc";
import {getRecentActivity} from "@/data/arc-source";
import {eventsToTransfers, OBSERVATION_WINDOW_MS} from "@/data/activity-engine";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;
let lastHealthyLogAt = 0;
let lastArchiveBucket = -1;

export async function GET() {
  const startedAt = Date.now();
  try {
    const data = await getRecentActivity();
    const bucket=Math.floor(Date.now()/300000);
    if(archiveConfigured()&&data.diagnostics.status==="ok"&&bucket!==lastArchiveBucket){lastArchiveBucket=bucket;after(async()=>{try{await captureObservation();}catch{lastArchiveBucket=-1;}});}

    const durationMs = Date.now() - startedAt;
    if (data.diagnostics.status !== "ok" || durationMs > 5_000 || Date.now() - lastHealthyLogAt >= 60_000) {
      const record = JSON.stringify({event: "arc_activity", status: data.diagnostics.status, durationMs, headAgeMs: data.diagnostics.headAgeMs, windowCovered: data.diagnostics.windowCovered, blocksScanned: data.diagnostics.blocksScanned, rpcRequests: data.diagnostics.rpcRequestCount.total, ingestionMs: Math.round(data.diagnostics.stageTimingsMs.total), warningCount: data.diagnostics.rpcWarnings.length});
      if (data.diagnostics.status === "ok" && durationMs <= 5_000) {lastHealthyLogAt = Date.now(); console.info(record);}
      else console.warn(record);
    }
    return NextResponse.json({
      network: ARC.name,
      chainId: ARC.chainId,
      latestBlock: data.latestBlock.toString(),
      events: data.events,
      transfers: eventsToTransfers(data.events),
      observationWindowMs: OBSERVATION_WINDOW_MS,
      fetchedAt: Date.now(),
      ...data.diagnostics,
    }, {headers: {"Cache-Control": "no-store", "Vercel-CDN-Cache-Control": data.diagnostics.status === "ok" ? "public, s-maxage=6, stale-while-revalidate=3" : "no-store"}});
  } catch (error) {
    console.error(JSON.stringify({event: "arc_activity", status: "error", durationMs: Date.now() - startedAt, error: error instanceof Error ? error.message.slice(0, 240) : "Unknown RPC failure"}));
    return NextResponse.json({
      error: "Arc Mainnet activity is temporarily unavailable",
      network: ARC.name,
      chainId: ARC.chainId,
      events: [],
      transfers: [],
      status: "error",
      rpcWarnings: [error instanceof Error ? error.message.slice(0, 240) : "Unknown RPC failure"],
      fetchedAt: Date.now(),
    }, {status: 503, headers: {"Cache-Control": "no-store"}});
  }
}
