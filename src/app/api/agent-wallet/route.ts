import {NextResponse} from "next/server";
import {getAgentWalletStatus} from "@/circle/wallet-observer";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const wallet = await getAgentWalletStatus();
  return NextResponse.json(wallet, {status: wallet.status === "unavailable" ? 503 : 200, headers: {"Cache-Control": "no-store"}});
}
