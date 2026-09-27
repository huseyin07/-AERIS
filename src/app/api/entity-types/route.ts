import {NextRequest, NextResponse} from "next/server";
import {createPublicClient, http} from "viem";
import {ARC, arcChain} from "@/data/arc";
import {createEntityClassifier} from "@/data/entity-classifier";
import type {HexAddress} from "@/data/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const rpc = createPublicClient({chain: arcChain, transport: http(ARC.rpcUrl, {timeout: 4_000, retryCount: 0})});
const classify = createEntityClassifier(rpc);
const addressPattern = /^0x[\da-f]{40}$/i;

export async function POST(request: NextRequest) {
  try {
    const body = await request.text();
    if (body.length > 500) return NextResponse.json({error: "Request too large"}, {status: 413});
    const parsed: unknown = JSON.parse(body);
    const addresses = (parsed as {addresses?: unknown})?.addresses;
    if (!Array.isArray(addresses) || addresses.length > 6 || !addresses.every(value => typeof value === "string" && addressPattern.test(value))) {
      return NextResponse.json({error: "Invalid addresses"}, {status: 400});
    }
    const types = await classify([...new Set(addresses.map(value => value.toLowerCase() as HexAddress))]);
    return NextResponse.json({chainId: ARC.chainId, types}, {headers: {"Cache-Control": "no-store"}});
  } catch {
    return NextResponse.json({error: "Classification unavailable"}, {status: 503, headers: {"Cache-Control": "no-store"}});
  }
}
