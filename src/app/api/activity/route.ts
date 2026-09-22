import {NextResponse} from "next/server";
import {ARC} from "@/data/arc";
import {activityErrorLog, getRecentActivity} from "@/data/arc-source";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const headers = {"Cache-Control": "no-store"};

export async function GET() {
  try {
    const data = await getRecentActivity();
    console.info("AERIS_ACTIVITY_SUCCESS", {
      chainId: ARC.chainId,
      latestBlock: data.latestBlock.toString(),
      transferCount: data.transfers.length,
      logCount: data.diagnostics.logCount,
      rejectedLogCount: data.diagnostics.rejectedLogCount,
      classifiedAddressCount: data.diagnostics.classifiedAddressCount,
    });
    return NextResponse.json({
      network: ARC.name,
      chainId: ARC.chainId,
      latestBlock: data.latestBlock.toString(),
      transfers: data.transfers,
      fetchedAt: Date.now(),
    }, {headers});
  } catch (error) {
    const diagnostic = activityErrorLog(error);
    console.error(JSON.stringify(diagnostic));
    return NextResponse.json({
      error: "Arc Mainnet activity is temporarily unavailable",
      code: diagnostic.code,
      network: ARC.name,
      chainId: ARC.chainId,
      transfers: [],
    }, {status: 503, headers});
  }
}
