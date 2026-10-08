import { NextRequest, NextResponse } from "next/server";
import { createPublicClient, erc20Abi, formatUnits, http } from "viem";
import { ARC, arcChain } from "@/data/arc";
import { PAYMENT_TOKEN, paymentData, validateInvoice } from "@/payments/core";
import { address } from "@/payments/visitor-wallet";
export const dynamic = "force-dynamic";
let running = 0;
export async function GET(request: NextRequest) {
  let payer: `0x${string}`,
    before: bigint | undefined,
    offset = 0;
  try {
    payer = address(request.nextUrl.searchParams.get("payer"));
    const cursor = request.nextUrl.searchParams.get("before");
    if (cursor) {
      if (!/^\d{1,12}$/.test(cursor)) throw Error();
      before = BigInt(cursor);
      if (before === 0n) throw Error();
    }
    const rawOffset = request.nextUrl.searchParams.get("offset") ?? "0";
    if (!/^\d{1,6}$/.test(rawOffset)) throw Error();
    offset = Number(rawOffset);
  } catch {
    return NextResponse.json(
      { message: "Invalid wallet or history cursor." },
      { status: 400 },
    );
  }
  if (running >= 8)
    return NextResponse.json(
      { message: "History checks are busy. Retry shortly." },
      { status: 503 },
    );
  running++;
  try {
    const rpc = createPublicClient({
      chain: arcChain,
      transport: http(ARC.rpcUrl, {
        fetchOptions: { cache: "no-store" },
        timeout: 8000,
        retryCount: 0,
      }),
    });
    const [chain, head] = await Promise.all([rpc.getChainId(), rpc.getBlock()]);
    const age = Date.now() - Number(head.timestamp) * 1000;
    if (chain !== 5042 || head.number === null || age > 120000 || age < -30000)
      throw Error();
    const to = before !== undefined ? before - 1n : head.number - 1n;
    if (to < 0n || to >= head.number) throw Error();
    const from = to >= 4095n ? to - 4095n : 0n;
    const logs = await rpc.getContractEvents({
      address: PAYMENT_TOKEN,
      abi: erc20Abi,
      eventName: "Transfer",
      args: { from: payer },
      fromBlock: from,
      toBlock: to,
      strict: true,
    });
    const unique = [
      ...new Map(logs.map((l) => [l.transactionHash, l])).values(),
    ].sort(
      (a, b) =>
        Number(b.blockNumber! - a.blockNumber!) ||
        Number(b.transactionIndex! - a.transactionIndex!),
    );
    // At most 40 records per response; cursor never skips a block containing unreturned records.
    const selected = unique.slice(offset, offset + 40);
    let nextBefore = from === 0n ? null : from.toString(),
      nextOffset = 0;
    if (unique.length > offset + 40) {
      nextBefore = (to + 1n).toString();
      nextOffset = offset + 40;
    }
    const transfers = [];
    for (let i = 0; i < selected.length; i += 4) {
      const batch = await Promise.all(
        selected.slice(i, i + 4).map(async (log) => {
          if (
            !log.transactionHash ||
            log.args.to === payer ||
            log.args.value === 0n
          )
            return null;
          const [tx, block] = await Promise.all([
            rpc.getTransaction({ hash: log.transactionHash }),
            rpc.getBlock({ blockNumber: log.blockNumber! }),
          ]);
          const invoice = validateInvoice({
            version: 1,
            chainId: 5042,
            reference: `ARC-${log.transactionHash.slice(2, 18)}`,
            recipient: log.args.to,
            amountUsdc: formatUnits(log.args.value!, 6),
            purpose:
              "Recovered from Arc · original note is in your browser backup",
            dueAt: new Date(Number(block.timestamp) * 1000).toISOString(),
          });
          if (
            tx.from.toLowerCase() !== payer ||
            tx.to?.toLowerCase() !== PAYMENT_TOKEN ||
            tx.value !== 0n ||
            tx.input.toLowerCase() !== paymentData(invoice).toLowerCase()
          )
            return null;
          return {
            id: `arc-${log.transactionHash.slice(2)}`,
            payer,
            invoice,
            txHash: log.transactionHash,
            createdAt: invoice.dueAt,
            source: "arc",
          };
        }),
      );
      transfers.push(...batch.filter(Boolean));
    }
    return NextResponse.json(
      {
        version: 1,
        chainId: 5042,
        transfers,
        fromBlock: from.toString(),
        toBlock: to.toString(),
        nextBefore,
        nextOffset,
        scope:
          "Direct outgoing USDC transfers in this block range. Older history loads in pages. Notes come from a browser backup. Receipts require separate verification.",
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json(
      {
        message:
          "Arc history is unavailable. Your local records have not changed.",
      },
      { status: 503 },
    );
  } finally {
    running--;
  }
}
