import { NextRequest, NextResponse } from "next/server";
import { quoteArcTransfer } from "@/payments/arc-quote";
import { address, transferInvoice } from "@/payments/visitor-wallet";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const pending = new Map<string, Promise<unknown>>();
export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams;
  let payer, invoice;
  try {
    payer = address(query.get("payer"));
    invoice = transferInvoice(
      query.get("recipient") ?? "",
      query.get("amount") ?? "",
      "USDC transfer",
    );
    if (payer === invoice.recipient) throw new Error();
  } catch {
    return NextResponse.json(
      {
        message:
          "Enter a valid sender, different recipient and positive USDC amount.",
      },
      { status: 400 },
    );
  }
  const key = `${payer}:${invoice.recipient}:${invoice.amountUsdc}`;
  if (pending.size >= 20 && !pending.has(key))
    return NextResponse.json(
      { message: "Network checks are busy. Retry shortly." },
      { status: 503 },
    );
  if (!pending.has(key))
    pending.set(
      key,
      (async () => {
        return quoteArcTransfer(payer, invoice);
      })().finally(() => pending.delete(key)),
    );
  try {
    return NextResponse.json(await pending.get(key), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return NextResponse.json(
      {
        message:
          error instanceof Error && error.message.startsWith("Your Arc")
            ? error.message
            : "Cannot prepare this transfer. Check your Arc USDC balance and retry when the network is available.",
      },
      { status: 422, headers: { "Cache-Control": "no-store" } },
    );
  }
}
