import { createHmac, timingSafeEqual } from "node:crypto";
import { units, type Invoice } from "./core";
type Proof = {
  hash: string;
  payer: string;
  recipient: string;
  amount: string;
  nonce: number;
  expiresAt: number;
};
function signature(data: string, key: string) {
  return createHmac("sha256", Buffer.from(key, "hex"))
    .update(`aeris.arc.nonce.v1:${data}`)
    .digest();
}
export function signNonceProof(
  hash: string,
  payer: string,
  invoice: Invoice,
  nonce: number,
  key: string,
  now = Date.now(),
) {
  if (!/^[a-f\d]{64}$/i.test(key) || !Number.isSafeInteger(nonce) || nonce < 0)
    return undefined;
  const data = Buffer.from(
    JSON.stringify({
      hash: hash.toLowerCase(),
      payer: payer.toLowerCase(),
      recipient: invoice.recipient,
      amount: units(invoice.amountUsdc).toString(),
      nonce,
      expiresAt: now + 7 * 86400000,
    } satisfies Proof),
  ).toString("base64url");
  return `${data}.${signature(data, key).toString("base64url")}`;
}
export function readNonceProof(
  value: string,
  hash: string,
  payer: string,
  invoice: Invoice,
  key: string,
  now = Date.now(),
): number | undefined {
  try {
    if (!/^[a-f\d]{64}$/i.test(key) || value.length > 2000) return;
    const parts = value.split(".");
    if (parts.length !== 2) return;
    const sig = Buffer.from(parts[1], "base64url"),
      expected = signature(parts[0], key);
    if (sig.length !== expected.length || !timingSafeEqual(sig, expected))
      return;
    const v = JSON.parse(
      Buffer.from(parts[0], "base64url").toString(),
    ) as Proof;
    if (
      v.hash !== hash.toLowerCase() ||
      v.payer !== payer.toLowerCase() ||
      v.recipient !== invoice.recipient ||
      v.amount !== units(invoice.amountUsdc).toString() ||
      !Number.isFinite(v.expiresAt) ||
      v.expiresAt <= now ||
      !Number.isSafeInteger(v.nonce) ||
      v.nonce < 0
    )
      return;
    return v.nonce;
  } catch {
    return;
  }
}
