import { NextRequest, NextResponse } from "next/server";
import { createPublicClient, http, type Hex } from "viem";
import { arcChain, ARC } from "@/data/arc";
import { getAgentWalletStatus } from "@/circle/wallet-observer";
import {
  PAYMENT_EXPLORER,
  PAYMENT_TOKEN,
  paymentData,
  isConfirmedFailedTransfer,
  validateInvoice,
  verifyPaymentEvidence,
} from "@/payments/core";
import { readNonceProof, signNonceProof } from "@/payments/nonce-proof";
import { address } from "@/payments/visitor-wallet";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const pending = new Map<string, Promise<unknown>>();
export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams;
  const hash = query.get("hash") ?? "";
  const previous = query.get("previous") ?? "";
  const proof = query.get("proof") ?? "";
  let invoice;
  let requestedPayer: string | undefined;
  try {
    if (previous && !/^0x[\da-f]{64}$/i.test(previous)) throw new Error();
    if (!/^0x[\da-f]{64}$/i.test(hash)) throw new Error();
    invoice = validateInvoice({
      version: 1,
      chainId: 5042,
      reference: "receipt-check",
      recipient: query.get("recipient"),
      amountUsdc: query.get("amount"),
      dueAt: "2026-01-01T00:00:00.000Z",
      purpose: "Verify invoice settlement",
    });
    if (query.has("payer")) requestedPayer = address(query.get("payer"));
  } catch {
    return NextResponse.json(
      {
        status: "invalid",
        message:
          "Enter a valid transaction hash, recipient and exact USDC amount.",
      },
      { status: 400 },
    );
  }
  const key = `${requestedPayer ?? "circle"}:${hash.toLowerCase()}:${invoice.recipient}:${invoice.amountUsdc}:${previous.toLowerCase()}:${proof}`;
  if (pending.size >= 25 && !pending.has(key))
    return NextResponse.json(
      {
        status: "unavailable",
        message: "Verification is busy. Retry shortly.",
      },
      { status: 503 },
    );
  if (!pending.has(key))
    pending.set(
      key,
      (async () => {
        let payer = requestedPayer;
        if (!payer) {
          const wallet = await getAgentWalletStatus();
          if (wallet.status !== "verified" || !wallet.address)
            throw new Error("Identity unavailable");
          payer = wallet.address;
        }
        const rpc = createPublicClient({
          chain: arcChain,
          transport: http(ARC.rpcUrl, {
            fetchOptions: {
              cache: "no-store",
              headers: { "Cache-Control": "no-cache" },
            },
            timeout: 8_000,
            retryCount: 0,
          }),
        });
        const [chainId, head] = await Promise.all([
          rpc.getChainId(),
          rpc.getBlock(),
        ]);
        const age = Date.now() - Number(head.timestamp) * 1000;
        if (
          chainId !== 5042 ||
          head.number === null ||
          age > 120_000 ||
          age < -30_000
        )
          throw new Error("Unverified head");
        let tx;
        try {
          tx = await rpc.getTransaction({ hash: hash as Hex });
        } catch (error) {
          if (
            requestedPayer &&
            (error as Error).name === "TransactionNotFoundError"
          )
            return {
              status: "unknown",
              message:
                "Arc has not found this hash. It may be propagating, replaced or dropped. Check wallet activity; do not resend automatically.",
            };
          throw error;
        }
        let cancellation = false;
        if (previous) {
          if (!requestedPayer || previous.toLowerCase() === hash.toLowerCase())
            throw Error("Invalid replacement");
          const signedNonce = readNonceProof(
            proof,
            previous,
            payer,
            invoice,
            process.env.CIRCLE_USER_SESSION_KEY ?? "",
          );
          if (signedNonce !== undefined) {
            if (signedNonce !== tx.nonce)
              throw Error("Replacement nonce mismatch");
          } else {
            const original = await rpc.getTransaction({
              hash: previous as Hex,
            });
            if (
              original.from.toLowerCase() !== payer.toLowerCase() ||
              original.chainId !== 5042 ||
              original.nonce !== tx.nonce ||
              original.to?.toLowerCase() !== PAYMENT_TOKEN ||
              original.input.toLowerCase() !==
                paymentData(invoice).toLowerCase() ||
              original.value !== 0n
            )
              throw Error("Replacement does not match original request");
          }
          cancellation =
            tx.from.toLowerCase() === payer.toLowerCase() &&
            tx.to?.toLowerCase() === payer.toLowerCase() &&
            tx.value === 0n &&
            tx.input === "0x" &&
            tx.chainId === 5042;
        }
        if (
          !cancellation &&
          (tx.from.toLowerCase() !== payer.toLowerCase() ||
            tx.to?.toLowerCase() !== PAYMENT_TOKEN ||
            tx.input.toLowerCase() !== paymentData(invoice).toLowerCase() ||
            tx.value !== 0n ||
            tx.chainId !== 5042)
        )
          throw new Error("Transfer details do not match");
        const nonceProof = !cancellation
          ? signNonceProof(
              hash,
              payer,
              invoice,
              tx.nonce,
              process.env.CIRCLE_USER_SESSION_KEY ?? "",
            )
          : undefined;
        let receipt;
        try {
          receipt = await rpc.getTransactionReceipt({ hash: hash as Hex });
        } catch (error) {
          if (
            requestedPayer &&
            (error as Error).name === "TransactionReceiptNotFoundError"
          )
            return {
              status: "pending",
              nonceProof,
              txHash: hash,
              nonce: tx.nonce,
              explorerUrl: `${PAYMENT_EXPLORER}/tx/${hash}`,
              message:
                "Submitted to Arc; not yet confirmed. To speed up or cancel, use this transaction in your wallet. Either action can incur a network fee.",
            };
          throw error;
        }
        if (requestedPayer && head.number < receipt.blockNumber + 1n)
          return {
            status: "confirming",
            nonceProof,
            txHash: hash,
            blockNumber: receipt.blockNumber.toString(),
            message:
              "Included in a block; waiting for another block before receipt verification.",
          };
        const block = await rpc.getBlock({ blockNumber: receipt.blockNumber });
        if (cancellation) {
          if (
            receipt.status !== "success" ||
            receipt.blockHash !== block.hash ||
            receipt.transactionHash.toLowerCase() !== hash.toLowerCase()
          )
            throw Error("Cancellation is not confirmed");
          return {
            status: "cancelled",
            txHash: hash,
            previousHash: previous,
            blockNumber: receipt.blockNumber.toString(),
            explorerUrl: `${PAYMENT_EXPLORER}/tx/${hash}`,
            message:
              "A confirmed self-transaction consumed the original nonce. This USDC transfer was cancelled; a network fee may have been charged.",
          };
        }
        if (
          requestedPayer &&
          isConfirmedFailedTransfer(
            invoice,
            payer,
            receipt,
            tx,
            head.number,
            block.hash!,
          )
        )
          return {
            status: "failed",
            txHash: hash,
            blockNumber: receipt.blockNumber.toString(),
            explorerUrl: `${PAYMENT_EXPLORER}/tx/${hash}`,
            message:
              "This confirmed transaction reverted. The transfer did not complete; a network fee may have been charged.",
          };
        const evidence = verifyPaymentEvidence(
          invoice,
          payer,
          receipt,
          tx,
          head.number,
          block.hash!,
        );
        return {
          status: "verified",
          chainId: 5042,
          payer,
          recipient: invoice.recipient,
          amountUsdc: invoice.amountUsdc,
          checkedAt: new Date().toISOString(),
          ...evidence,
          message: requestedPayer
            ? "Sender, recipient and exact USDC amount match a confirmed Arc transfer."
            : "Circle payer identity and matching confirmed Arc USDC settlement verified.",
        };
      })().finally(() => pending.delete(key)),
    );
  try {
    return NextResponse.json(await pending.get(key), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return NextResponse.json(
      {
        status: "unverified",
        message:
          "No matching confirmed payment could be verified. Check the hash, recipient and exact amount, or retry when Arc is available.",
      },
      { status: 422, headers: { "Cache-Control": "no-store" } },
    );
  }
}
