import {NextRequest, NextResponse} from "next/server";
import {createPublicClient, http, type Hex} from "viem";
import {arcChain, ARC} from "@/data/arc";
import {getAgentWalletStatus} from "@/circle/wallet-observer";
import {validateInvoice, verifyPaymentEvidence} from "@/payments/core";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const pending = new Map<string, Promise<unknown>>();
export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams;
  const hash = query.get("hash") ?? "";
  let invoice;
  try {
    if (!/^0x[\da-f]{64}$/i.test(hash)) throw new Error();
    invoice = validateInvoice({version: 1, chainId: 5042, reference: "receipt-check", recipient: query.get("recipient"), amountUsdc: query.get("amount"), dueAt: "2026-01-01T00:00:00.000Z", purpose: "Verify invoice settlement"});
  } catch {return NextResponse.json({status: "invalid", message: "Enter a valid transaction hash, recipient and exact USDC amount."}, {status: 400});}
  const key = `${hash.toLowerCase()}:${invoice.recipient}:${invoice.amountUsdc}`;
  if (pending.size >= 25 && !pending.has(key)) return NextResponse.json({status: "unavailable", message: "Verification is busy. Retry shortly."}, {status: 503});
  if (!pending.has(key)) pending.set(key, (async () => {
    const wallet = await getAgentWalletStatus();
    if (wallet.status !== "verified" || !wallet.address) throw new Error("Identity unavailable");
    const rpc = createPublicClient({chain: arcChain, transport: http(ARC.rpcUrl, {fetchOptions: {cache: "no-store", headers: {"Cache-Control": "no-cache"}}, timeout: 8_000, retryCount: 0})});
    const [chainId, head, receipt, tx] = await Promise.all([rpc.getChainId(), rpc.getBlock(), rpc.getTransactionReceipt({hash: hash as Hex}), rpc.getTransaction({hash: hash as Hex})]);
    const age = Date.now() - Number(head.timestamp) * 1000;
    if (chainId !== 5042 || head.number === null || age > 120_000 || age < -30_000) throw new Error("Unverified head");
    const block = await rpc.getBlock({blockNumber: receipt.blockNumber});
    const evidence = verifyPaymentEvidence(invoice, wallet.address, receipt, tx, head.number, block.hash!);
    return {status: "verified", chainId: 5042, payer: wallet.address, recipient: invoice.recipient, amountUsdc: invoice.amountUsdc, checkedAt: new Date().toISOString(), ...evidence, message: "Circle payer identity and matching confirmed Arc USDC settlement verified."};
  })().finally(() => pending.delete(key)));
  try {return NextResponse.json(await pending.get(key), {headers: {"Cache-Control": "no-store"}});}
  catch {return NextResponse.json({status: "unverified", message: "No matching confirmed payment could be verified. Check the hash, recipient and exact amount, or retry when Arc is available."}, {status: 422, headers: {"Cache-Control": "no-store"}});}
}
