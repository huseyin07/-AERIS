import {NextRequest, NextResponse} from "next/server";
import {createPublicClient, erc20Abi, formatUnits, http} from "viem";
import {ARC, arcChain} from "@/data/arc";
import {PAYMENT_TOKEN, paymentData, units} from "@/payments/core";
import {address, transferInvoice} from "@/payments/visitor-wallet";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const pending = new Map<string, Promise<unknown>>();
export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams;
  let payer, invoice;
  try {
    payer = address(query.get("payer")); invoice = transferInvoice(query.get("recipient") ?? "", query.get("amount") ?? "", "USDC transfer");
    if (payer === invoice.recipient) throw new Error();
  } catch {return NextResponse.json({message: "Enter a valid sender, different recipient and positive USDC amount."}, {status: 400});}
  const key = `${payer}:${invoice.recipient}:${invoice.amountUsdc}`;
  if (pending.size >= 20 && !pending.has(key)) return NextResponse.json({message: "Network checks are busy. Retry shortly."}, {status: 503});
  if (!pending.has(key)) pending.set(key, (async () => {
    const rpc = createPublicClient({chain: arcChain, transport: http(ARC.rpcUrl, {fetchOptions: {cache: "no-store"}, timeout: 8_000, retryCount: 0})});
    const [chainId, head] = await Promise.all([rpc.getChainId(), rpc.getBlock()]);
    const age = Date.now() - Number(head.timestamp) * 1000;
    if (chainId !== 5042 || head.number === null || age > 120_000 || age < -30_000) throw new Error("Arc is not reporting a current mainnet block.");
    const [balance, native, gas, fees] = await Promise.all([
      rpc.readContract({address: PAYMENT_TOKEN, abi: erc20Abi, functionName: "balanceOf", args: [payer], blockNumber: head.number}),
      rpc.getBalance({address: payer, blockNumber: head.number}),
      rpc.estimateGas({account: payer, to: PAYMENT_TOKEN, data: paymentData(invoice), value: 0n}),
      rpc.estimateFeesPerGas({type: "eip1559"}),
    ]);
    const gasLimit = (gas * 120n + 99n) / 100n;
    const fee = (gasLimit * fees.maxFeePerGas + 999_999_999_999n) / 1_000_000_000_000n;
    const total = units(invoice.amountUsdc) + fee;
    if (balance < total || native < total * 1_000_000_000_000n) throw new Error("Your Arc USDC balance cannot cover this transfer and its maximum network fee.");
    return {chainId, payer, recipient: invoice.recipient, amountUsdc: invoice.amountUsdc, balanceUsdc: formatUnits(balance, 6), maximumFeeUsdc: formatUnits(fee, 6), totalUsdc: formatUnits(total, 6), gas: gasLimit.toString(), maxFeePerGas: fees.maxFeePerGas.toString(), maxPriorityFeePerGas: fees.maxPriorityFeePerGas.toString(), checkedAt: Date.now(), blockNumber: head.number.toString()};
  })().finally(() => pending.delete(key)));
  try {return NextResponse.json(await pending.get(key), {headers: {"Cache-Control": "no-store"}});}
  catch (error) {return NextResponse.json({message: error instanceof Error && error.message.startsWith("Your Arc") ? error.message : "Cannot prepare this transfer. Check your Arc USDC balance and retry when the network is available."}, {status: 422, headers: {"Cache-Control": "no-store"}});}
}
