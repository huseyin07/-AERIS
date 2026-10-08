import {toHex, type Hex} from "viem";
import {PAYMENT_CHAIN, PAYMENT_EXPLORER, PAYMENT_RPC, PAYMENT_TOKEN, paymentData, units, validateInvoice, type Invoice} from "./core";

export type WalletProvider = {
  request(args: {method: string; params?: unknown[]}): Promise<unknown>;
  on?(event: string, listener: (...args: unknown[]) => void): void;
  removeListener?(event: string, listener: (...args: unknown[]) => void): void;
};
export type WalletChoice = {id: string; name: string; provider: WalletProvider};
export type TransferQuote = {chainId: number; payer: string; recipient: string; amountUsdc: string; balanceUsdc: string; maximumFeeUsdc: string; totalUsdc: string; gas: string; maxFeePerGas: string; maxPriorityFeePerGas: string; checkedAt: number; blockNumber: string};
export function address(value: unknown): `0x${string}` {
  if (typeof value !== "string" || !/^0x[\da-f]{40}$/i.test(value) || /^0x0{40}$/i.test(value)) throw new Error("Enter a full wallet address.");
  return value.toLowerCase() as `0x${string}`;
}
export function transferInvoice(recipient: string, amount: string, purpose: string): Invoice {
  return validateInvoice({version: 1, chainId: PAYMENT_CHAIN, reference: "visitor-transfer", recipient: recipient.trim(), amountUsdc: amount.trim(), dueAt: "2026-01-01T00:00:00.000Z", purpose: purpose.trim() || "USDC transfer"});
}
export async function walletAccount(provider: WalletProvider, requestAccess = false) {
  const accounts = await provider.request({method: requestAccess ? "eth_requestAccounts" : "eth_accounts"});
  if (!Array.isArray(accounts) || !accounts.length) throw new Error("Connect an unlocked wallet first.");
  return address(accounts[0]);
}
export async function switchToArc(provider: WalletProvider) {
  try {await provider.request({method: "wallet_switchEthereumChain", params: [{chainId: toHex(PAYMENT_CHAIN)}]});}
  catch (error) {
    if ((error as {code?: number}).code !== 4902) throw error;
    await provider.request({method: "wallet_addEthereumChain", params: [{chainId: toHex(PAYMENT_CHAIN), chainName: "Arc Mainnet", nativeCurrency: {name: "USDC", symbol: "USDC", decimals: 18}, rpcUrls: [PAYMENT_RPC], blockExplorerUrls: [PAYMENT_EXPLORER]}]});
    await provider.request({method: "wallet_switchEthereumChain", params: [{chainId: toHex(PAYMENT_CHAIN)}]});
  }
  if (Number(await provider.request({method: "eth_chainId"})) !== PAYMENT_CHAIN) throw new Error("Select Arc Mainnet in your wallet.");
}
export function validateQuote(q: TransferQuote, invoice: Invoice, payer: string, now = Date.now()) {
  if (!q || q.chainId !== PAYMENT_CHAIN || address(q.payer) !== address(payer) || q.recipient !== invoice.recipient || units(q.amountUsdc) !== units(invoice.amountUsdc)
    || !Number.isFinite(q.checkedAt) || now - q.checkedAt < 0 || now - q.checkedAt > 60_000) throw new Error("Transfer review expired or changed. Review it again.");
  for (const value of [q.gas, q.maxFeePerGas, q.maxPriorityFeePerGas]) if (!/^\d{1,30}$/.test(value) || BigInt(value) <= 0n) throw new Error("Invalid network fee estimate.");
  const fee = (BigInt(q.gas) * BigInt(q.maxFeePerGas) + 999_999_999_999n) / 1_000_000_000_000n;
  if (BigInt(q.maxPriorityFeePerGas) > BigInt(q.maxFeePerGas) || fee !== units(q.maximumFeeUsdc) || units(q.totalUsdc) !== units(invoice.amountUsdc) + fee || units(q.balanceUsdc, true) < units(q.totalUsdc)) throw new Error("Insufficient balance or inconsistent fee estimate.");
  if (invoice.recipient === address(payer)) throw new Error("Choose an address other than your connected wallet.");
  return q;
}
// The caller saves an unresolved attempt before calling this; this function never retries a submission.
export async function submitTransfer(provider: WalletProvider, payer: string, invoice: Invoice, quote: TransferQuote): Promise<Hex> {
  validateQuote(quote, invoice, payer);
  if (await walletAccount(provider) !== address(payer)) throw new Error("Connected account changed. Review the transfer again.");
  if (Number(await provider.request({method: "eth_chainId"})) !== PAYMENT_CHAIN) throw new Error("Wallet network changed. Select Arc Mainnet and review again.");
  const result = await provider.request({method: "eth_sendTransaction", params: [{from: address(payer), to: PAYMENT_TOKEN, data: paymentData(invoice), value: "0x0", chainId: toHex(PAYMENT_CHAIN), gas: toHex(BigInt(quote.gas)), maxFeePerGas: toHex(BigInt(quote.maxFeePerGas)), maxPriorityFeePerGas: toHex(BigInt(quote.maxPriorityFeePerGas))}]});
  if (typeof result !== "string" || !/^0x[\da-f]{64}$/i.test(result)) throw new Error("Wallet returned no transaction hash. Check wallet activity before doing anything else.");
  return result as Hex;
}
