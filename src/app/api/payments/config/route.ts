import {NextResponse} from "next/server";
import {getAgentWalletStatus} from "@/circle/wallet-observer";
export const dynamic = "force-dynamic";
export async function GET() {
  const wallet = await getAgentWalletStatus();
  if (wallet.status !== "verified") return NextResponse.json({message: "Circle payer verification is unavailable."}, {status: 503});
  const walletId = process.env.CIRCLE_EVM_WALLET_ID;
  if (!walletId || !/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(walletId) || wallet.address?.toLowerCase() !== process.env.CIRCLE_EVM_WALLET_ADDRESS?.toLowerCase()) return NextResponse.json({message: "Operator wallet identity is not configured."}, {status: 503});
  return NextResponse.json({walletId, address: wallet.address, chainId: 5042}, {headers: {"Cache-Control": "no-store"}});
}
