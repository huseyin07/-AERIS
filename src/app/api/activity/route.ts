import {NextResponse} from "next/server";
import {ARC} from "@/data/arc";
import {getRecentActivity} from "@/data/arc-source";
import {eventsToTransfers, OBSERVATION_WINDOW_MS} from "@/data/activity-engine";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const data = await getRecentActivity();
    return NextResponse.json({
      network: ARC.name,
      chainId: ARC.chainId,
      latestBlock: data.latestBlock.toString(),
      events: data.events,
      transfers: eventsToTransfers(data.events),
      observationWindowMs: OBSERVATION_WINDOW_MS,
      fetchedAt: Date.now(),
    }, {headers: {"Cache-Control": "no-store"}});
  } catch (error) {
    console.error("Arc Mainnet activity request failed", error);
    return NextResponse.json({
      error: "Arc Mainnet activity is temporarily unavailable",
      network: ARC.name,
      chainId: ARC.chainId,
      events: [],
      transfers: [],
    }, {status: 503, headers: {"Cache-Control": "no-store"}});
  }
}
