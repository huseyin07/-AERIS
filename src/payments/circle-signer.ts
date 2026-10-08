import {constants, publicEncrypt} from "node:crypto";
import {parseTransaction, recoverTransactionAddress, serializeTransaction, type Hex, type TransactionSerialized} from "viem";
import {validateCircleWallet} from "../circle/wallet-validation.ts";
import {paymentData, PAYMENT_TOKEN, type Invoice, type PaymentPolicy} from "./core.ts";

export async function circleRequest(apiKey: string, path: string, body?: unknown) {
  if (!apiKey.startsWith("LIVE_API_KEY:")) throw new Error("A mainnet LIVE_API_KEY is required.");
  const response = await fetch(`https://api.circle.com/v1/w3s/${path}`, {method: body ? "POST" : "GET", headers: {Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json"}, ...(body ? {body: JSON.stringify(body)} : {}), signal: AbortSignal.timeout(20_000)});
  if (!response.ok) throw new Error(`Circle request failed (HTTP ${response.status}). Credentials and provider bodies are never logged.`);
  return (await response.json()).data;
}
export async function verifySigner(apiKey: string, policy: PaymentPolicy) {
  const data = await circleRequest(apiKey, `wallets/${policy.walletId}`);
  const wallet = validateCircleWallet(data?.wallet, policy.walletId, policy.payer);
  if (wallet.blockchain !== "EVM") throw new Error("This runner requires a mainnet EVM Circle EOA for custom Arc signing.");
}
export async function validateSignedPayment(signed: Hex, unsigned: Hex, payer: string) {
  const tx = parseTransaction(signed);
  if (tx.chainId !== 5042 || !tx.r || !tx.s || serializeTransaction({...tx, r: undefined, s: undefined, v: undefined, yParity: undefined}) !== unsigned
    || (await recoverTransactionAddress({serializedTransaction: signed as TransactionSerialized})).toLowerCase() !== payer.toLowerCase()) throw new Error("Circle signature does not match the approved transaction and payer.");
}
export function validateUnsignedInvoice(unsigned: Hex, invoice: Invoice) {
  const tx = parseTransaction(unsigned);
  if (tx.chainId !== 5042 || tx.type !== "eip1559" || tx.to?.toLowerCase() !== PAYMENT_TOKEN || (tx.value ?? 0n) !== 0n || tx.data?.toLowerCase() !== paymentData(invoice).toLowerCase()
    || tx.gas === undefined || tx.gas <= 0n || tx.maxFeePerGas === undefined || tx.maxPriorityFeePerGas === undefined || (tx.accessList?.length ?? 0) !== 0 || tx.r || tx.s) throw new Error("Journal transaction does not match this invoice. Execution stopped.");
  return tx;
}
export async function signWithCircle(apiKey: string, entitySecret: string, policy: PaymentPolicy, unsigned: Hex, memo: string): Promise<Hex> {
  if (!/^[\da-f]{64}$/i.test(entitySecret)) throw new Error("Entity Secret must be the registered 64-character hex secret.");
  const key = await circleRequest(apiKey, "config/entity/publicKey");
  const entitySecretCiphertext = publicEncrypt({key: key.publicKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256"}, Buffer.from(entitySecret, "hex")).toString("base64");
  const result = await circleRequest(apiKey, "developer/sign/transaction", {walletId: policy.walletId, rawTransaction: unsigned, entitySecretCiphertext, memo});
  if (typeof result?.signedTransaction !== "string" || !/^0x[\da-f]+$/i.test(result.signedTransaction)) throw new Error("Circle returned an invalid EVM signed transaction.");
  const signed = result.signedTransaction as Hex;
  await validateSignedPayment(signed, unsigned, policy.payer);
  return signed;
}
