import { NextRequest, NextResponse } from "next/server";
import {
  initiateUserControlledWalletsClient,
  Blockchain,
} from "@circle-fin/user-controlled-wallets";
import { formatUnits } from "viem";
import {
  openCircleSession,
  ownArcWallet,
  sealCircleSession,
} from "@/circle/user-session";
import { PAYMENT_TOKEN, units, validateInvoice } from "@/payments/core";
import { address } from "@/payments/visitor-wallet";
import { quoteArcTransfer } from "@/payments/arc-quote";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const COOKIE = "__Host-aeris-circle";
const UUID = /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i;
const rate = new Map<string, { at: number; count: number }>();
function ready() {
  return (
    !!process.env.CIRCLE_USER_APP_ID &&
    process.env.CIRCLE_USER_EMAIL_READY === "true" &&
    /^[a-f\d]{64}$/i.test(process.env.CIRCLE_USER_SESSION_KEY ?? "") &&
    process.env.CIRCLE_API_KEY?.startsWith("LIVE_API_KEY:")
  );
}
const response = (data: unknown, status = 200) =>
  NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });
function sameOrigin(req: NextRequest) {
  const origin = req.headers.get("origin");
  try {
    return !!origin && new URL(origin).origin === req.nextUrl.origin;
  } catch {
    return false;
  }
}
async function body(req: NextRequest) {
  if (Number(req.headers.get("content-length") ?? 0) > 16000)
    throw Error("Request too large");
  const raw = await req.text();
  if (raw.length > 16000) throw Error("Request too large");
  return JSON.parse(raw);
}
function session(req: NextRequest) {
  return openCircleSession(
    req.cookies.get(COOKIE)?.value ?? "",
    process.env.CIRCLE_USER_SESSION_KEY ?? "",
  );
}
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ action: string }> },
) {
  const { action } = await params;
  if (!ready())
    return response(
      { message: "Circle user wallets await App ID and email-login setup." },
      503,
    );
  try {
    const s = session(req),
      client = initiateUserControlledWalletsClient({
        apiKey: process.env.CIRCLE_API_KEY!,
      });
    if (action === "session")
      return response({ appId: process.env.CIRCLE_USER_APP_ID, ...s });
    const { data } = await client.listWallets({
      userToken: s.userToken,
      blockchain: Blockchain.Arc,
    });
    const wallets = (data?.wallets ?? []).filter(
      (w) =>
        w.blockchain === "ARC" &&
        w.accountType === "EOA" &&
        w.custodyType === "ENDUSER",
    );
    if (action === "wallets") return response({ wallets });
    if (action === "transactions") {
      const id = req.nextUrl.searchParams.get("walletId") ?? "";
      ownArcWallet(wallets, id);
      const pageAfter = req.nextUrl.searchParams.get("pageAfter") ?? undefined;
      if (pageAfter && !/^[\w-]{1,100}$/.test(pageAfter))
        return response({ message: "Invalid page cursor." }, 400);
      const tx = await client.listTransactions({
        userToken: s.userToken,
        walletIds: [id],
        blockchain: Blockchain.Arc,
        pageSize: 50,
        pageAfter,
      });
      return response(tx.data);
    }
    return response({ message: "Unknown endpoint." }, 404);
  } catch {
    return response(
      {
        message:
          "Circle session or wallet access is unavailable. Sign in again.",
      },
      401,
    );
  }
}
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ action: string }> },
) {
  const { action } = await params;
  if (!sameOrigin(req))
    return response({ message: "Same-origin request required." }, 403);
  if (action === "logout") {
    const r = response({ signedOut: true });
    r.cookies.set(COOKIE, "", {
      httpOnly: true,
      secure: true,
      sameSite: "strict",
      path: "/",
      maxAge: 0,
    });
    return r;
  }
  if (!ready())
    return response(
      { message: "Circle user wallets await App ID and email-login setup." },
      503,
    );
  try {
    const input = await body(req),
      client = initiateUserControlledWalletsClient({
        apiKey: process.env.CIRCLE_API_KEY!,
      });
    if (action === "otp") {
      if (
        typeof input.email !== "string" ||
        input.email.length > 254 ||
        !/^\S+@\S+\.\S+$/.test(input.email) ||
        typeof input.deviceId !== "string" ||
        !/^[\w-]{10,100}$/.test(input.deviceId)
      )
        return response({ message: "Enter a valid email." }, 400);
      const ip = req.headers.get("x-forwarded-for")?.split(",")[0] ?? "unknown";
      const now = Date.now();
      for (const [key, v] of rate) if (now - v.at > 3600000) rate.delete(key);
      const r = rate.get(ip);
      if ((r && now - r.at < 60000) || (r && r.count >= 5) || rate.size >= 1000)
        return response(
          { message: "Please wait before requesting another code." },
          429,
        );
      rate.set(ip, { at: now, count: (r?.count ?? 0) + 1 });
      const tokens = await client.createDeviceTokenForEmailLogin({
        email: input.email,
        deviceId: input.deviceId,
      });
      return response(tokens.data);
    }
    if (action === "session") {
      if (
        typeof input.userToken !== "string" ||
        !input.userToken.length ||
        input.userToken.length > 2500 ||
        typeof input.encryptionKey !== "string" ||
        !input.encryptionKey.length ||
        input.encryptionKey.length > 400
      )
        return response({ message: "Invalid session." }, 400);
      await client.listWallets({ userToken: input.userToken });
      const r = response({ signedIn: true });
      r.cookies.set(
        COOKIE,
        sealCircleSession(
          {
            userToken: input.userToken,
            encryptionKey: input.encryptionKey,
            expiresAt: Date.now() + 50 * 60000,
          },
          process.env.CIRCLE_USER_SESSION_KEY!,
        ),
        {
          httpOnly: true,
          secure: true,
          sameSite: "strict",
          path: "/",
          maxAge: 50 * 60,
        },
      );
      return r;
    }
    const s = session(req);
    if (action === "initialize") {
      if (
        typeof input.idempotencyKey !== "string" ||
        !UUID.test(input.idempotencyKey)
      )
        return response({ message: "Invalid request reference." }, 400);
      const wallets = await client.listWallets({
        userToken: s.userToken,
        blockchain: Blockchain.Arc,
      });
      if (
        wallets.data?.wallets?.some(
          (w) => w.accountType === "EOA" && w.custodyType === "ENDUSER",
        )
      )
        return response({ existing: true });
      try {
        const result = await client.createUserPinWithWallets({
          userToken: s.userToken,
          blockchains: [Blockchain.Arc],
          accountType: "EOA",
          idempotencyKey: input.idempotencyKey,
        });
        return response(result.data);
      } catch (e) {
        if (
          (e as { response?: { data?: { code?: number } } }).response?.data
            ?.code !== 155106
        )
          throw e;
        const result = await client.createWallet({
          userToken: s.userToken,
          blockchains: [Blockchain.Arc],
          accountType: "EOA",
          idempotencyKey: input.idempotencyKey,
        });
        return response(result.data);
      }
    }
    const wallets = await client.listWallets({
      userToken: s.userToken,
      blockchain: Blockchain.Arc,
    });
    const wallet = ownArcWallet(wallets.data?.wallets ?? [], input.walletId);
    if (action === "transfer") {
      if (
        typeof input.idempotencyKey !== "string" ||
        !UUID.test(input.idempotencyKey)
      )
        return response({ message: "Invalid transfer reference." }, 400);
      const invoice = validateInvoice(input.invoice);
      if (invoice.recipient === wallet.address.toLowerCase())
        return response({ message: "Choose another recipient." }, 400);
      const q = await quoteArcTransfer(address(wallet.address), invoice);
      if (units(q.maximumFeeUsdc) > units(input.maximumFeeUsdc))
        return response(
          { message: "Network fee increased. Review again." },
          409,
        );
      const result =
        await client.createUserTransactionContractExecutionChallenge({
          userToken: s.userToken,
          walletId: wallet.id,
          contractAddress: PAYMENT_TOKEN,
          abiFunctionSignature: "transfer(address,uint256)",
          abiParameters: [
            invoice.recipient,
            units(invoice.amountUsdc).toString(),
          ],
          amount: "0",
          idempotencyKey: input.idempotencyKey,
          refId: input.idempotencyKey,
          fee: {
            type: "absolute",
            config: {
              gasLimit: q.gas,
              maxFee: formatUnits(BigInt(q.maxFeePerGas), 9),
              priorityFee: formatUnits(BigInt(q.maxPriorityFeePerGas), 9),
            },
          },
        });
      return response({ ...result.data, reference: input.idempotencyKey });
    }
    if (action === "accelerate" || action === "cancel") {
      if (
        typeof input.transactionId !== "string" ||
        !UUID.test(input.transactionId)
      )
        return response({ message: "Invalid transaction." }, 400);
      const tx = await client.getTransaction({
        userToken: s.userToken,
        id: input.transactionId,
      });
      if (tx.data?.transaction?.walletId !== wallet.id)
        return response(
          { message: "Transaction belongs to another wallet." },
          403,
        );
      if (
        !["INITIATED", "QUEUED", "PENDING", "SENT"].includes(
          tx.data?.transaction?.state ?? "",
        )
      )
        return response(
          { message: "This transaction is no longer pending." },
          409,
        );
      const result =
        action === "accelerate"
          ? await client.accelerateTransaction({
              userToken: s.userToken,
              id: input.transactionId,
            })
          : await client.cancelTransaction({
              userToken: s.userToken,
              id: input.transactionId,
            });
      return response(result.data);
    }
    return response({ message: "Unknown operation." }, 404);
  } catch (error) {
    const code = (error as { response?: { data?: { code?: number } } }).response
      ?.data?.code;
    return response(
      {
        message:
          code === 155106
            ? "This user is already initialized. Load existing wallets."
            : "Circle request could not be completed. Check your session and retry only after reviewing existing requests.",
        code,
      },
      422,
    );
  }
}
