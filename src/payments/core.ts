import {decodeEventLog, encodeFunctionData, erc20Abi, parseUnits, type Hex} from "viem";

export const PAYMENT_CHAIN = 5042;
export const PAYMENT_TOKEN = "0x3600000000000000000000000000000000000000" as const;
export const PAYMENT_RPC = "https://rpc.mainnet.arc.io";
export const PAYMENT_EXPLORER = "https://arcscan.app";
const ADDRESS = /^0x[\da-f]{40}$/i;
export type Invoice = {version: 1; chainId: 5042; reference: string; recipient: `0x${string}`; amountUsdc: string; dueAt: string; purpose: string};
export type PaymentPolicy = {version: 1; walletId: string; payer: `0x${string}`; allowedRecipients: string[]; maxPaymentUsdc: string; dailyBudgetUsdc: string; maxGasUsdc: string; reserveUsdc: string; autoPay: boolean; approvalAboveUsdc: string; emergencyStop: boolean};
export function units(value: unknown, zero = false): bigint {
  if (typeof value !== "string" || !/^\d{1,9}(\.\d{1,6})?$/.test(value)) throw new Error("Use a USDC amount with at most 6 decimals.");
  const amount = parseUnits(value, 6);
  if (amount < 0n || (!zero && amount === 0n)) throw new Error("USDC amount must be positive.");
  return amount;
}
export function validateInvoice(value: unknown): Invoice {
  const v = value as Invoice;
  if (!v || v.version !== 1 || v.chainId !== PAYMENT_CHAIN || typeof v.reference !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(v.reference)
    || !ADDRESS.test(v.recipient) || /^0x0{40}$/i.test(v.recipient) || v.recipient.toLowerCase() === PAYMENT_TOKEN
    || typeof v.purpose !== "string" || !v.purpose.trim() || v.purpose.length > 160
    || typeof v.dueAt !== "string" || !Number.isFinite(Date.parse(v.dueAt))) throw new Error("Invalid Arc invoice. Check reference, recipient, purpose and due date.");
  units(v.amountUsdc);
  return {version: 1, chainId: PAYMENT_CHAIN, reference: v.reference, recipient: v.recipient.toLowerCase() as `0x${string}`, amountUsdc: v.amountUsdc, dueAt: new Date(v.dueAt).toISOString(), purpose: v.purpose.trim()};
}
export function invoiceKey(invoice: Invoice) {return `${invoice.recipient}:${invoice.reference}`;}
export function invoiceFingerprint(invoice: Invoice) {return JSON.stringify([PAYMENT_CHAIN, invoice.reference, invoice.recipient, units(invoice.amountUsdc).toString(), invoice.dueAt, invoice.purpose]);}
export function validatePolicy(value: unknown): PaymentPolicy {
  const p = value as PaymentPolicy;
  if (!p || p.version !== 1 || !/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(p.walletId) || !ADDRESS.test(p.payer) || /^0x0{40}$/i.test(p.payer)
    || !Array.isArray(p.allowedRecipients) || !p.allowedRecipients.length || p.allowedRecipients.length > 20 || p.allowedRecipients.some(a => typeof a !== "string" || !ADDRESS.test(a) || /^0x0{40}$/i.test(a))
    || typeof p.autoPay !== "boolean" || typeof p.emergencyStop !== "boolean") throw new Error("Invalid operator policy.");
  [p.maxPaymentUsdc, p.dailyBudgetUsdc, p.maxGasUsdc].forEach(v => units(v));
  [p.reserveUsdc, p.approvalAboveUsdc].forEach(v => units(v, true));
  if (units(p.maxPaymentUsdc) > units(p.dailyBudgetUsdc)) throw new Error("Per-payment limit exceeds daily budget.");
  return {...p, payer: p.payer.toLowerCase() as `0x${string}`, allowedRecipients: [...new Set(p.allowedRecipients.map(a => a.toLowerCase()))]};
}
export function decidePayment(invoice: Invoice, policy: PaymentPolicy, available: bigint, reservedToday: bigint, gas: bigint, now = Date.now()) {
  const amount = units(invoice.amountUsdc);
  const hold = (reason: string) => ({action: "hold" as const, reason, requiresApproval: false});
  if (policy.emergencyStop) return hold("Emergency stop is active.");
  if (invoice.recipient === policy.payer) return hold("The payer cannot pay itself.");
  if (!policy.allowedRecipients.includes(invoice.recipient)) return hold("Recipient is not in the operator allowlist.");
  if (Date.parse(invoice.dueAt) > now) return hold("Invoice is not due yet.");
  if (amount > units(policy.maxPaymentUsdc)) return hold("Per-payment limit exceeded.");
  if (gas < 0n || gas > units(policy.maxGasUsdc)) return hold("Estimated gas exceeds the operator limit.");
  if (reservedToday + amount + gas > units(policy.dailyBudgetUsdc)) return hold("Daily budget, including reserved gas, would be exceeded.");
  if (amount + gas + units(policy.reserveUsdc, true) > available) return hold("Insufficient USDC after payment, gas and treasury reserve.");
  const requiresApproval = !policy.autoPay || amount > units(policy.approvalAboveUsdc, true);
  return {action: "pay" as const, reason: "Invoice is due; recipient, liquidity and budget checks passed.", requiresApproval};
}
export function paymentData(invoice: Invoice): Hex {
  return encodeFunctionData({abi: erc20Abi, functionName: "transfer", args: [invoice.recipient, units(invoice.amountUsdc)]});
}
export type ReceiptEvidence = {transactionHash: Hex; status: string; from: string; to: string | null; blockNumber: bigint; blockHash: Hex; gasUsed: bigint; effectiveGasPrice: bigint; logs: {address: string; data: Hex; topics: readonly Hex[]; logIndex: number | null}[]};
export function verifyPaymentEvidence(invoice: Invoice, payer: string, receipt: ReceiptEvidence, tx: {hash: string; from: string; to: string | null; input: string; value: bigint; chainId?: number}, head: bigint, canonicalBlockHash: string) {
  if (receipt.status !== "success" || receipt.transactionHash.toLowerCase() !== tx.hash.toLowerCase() || receipt.blockHash.toLowerCase() !== canonicalBlockHash.toLowerCase()
    || receipt.from.toLowerCase() !== payer.toLowerCase() || tx.from.toLowerCase() !== payer.toLowerCase()
    || receipt.to?.toLowerCase() !== PAYMENT_TOKEN || tx.to?.toLowerCase() !== PAYMENT_TOKEN || tx.input.toLowerCase() !== paymentData(invoice).toLowerCase() || tx.value !== 0n
    || (tx.chainId !== undefined && tx.chainId !== PAYMENT_CHAIN) || head < receipt.blockNumber + 1n) throw new Error("Payment is not a matching, confirmed Arc USDC transfer.");
  const matching = receipt.logs.filter(log => {
    if (log.address.toLowerCase() !== PAYMENT_TOKEN) return false;
    try {
      const decoded = decodeEventLog({abi: erc20Abi, data: log.data, topics: log.topics as [Hex, ...Hex[]], eventName: "Transfer"});
      return decoded.args.from.toLowerCase() === payer.toLowerCase() && decoded.args.to.toLowerCase() === invoice.recipient && decoded.args.value === units(invoice.amountUsdc);
    } catch {return false;}
  });
  if (matching.length !== 1 || matching[0].logIndex === null) throw new Error("Matching USDC transfer event is missing or ambiguous.");
  return {txHash: receipt.transactionHash, blockNumber: receipt.blockNumber.toString(), logIndex: matching[0].logIndex, gasCostNativeUnits: (receipt.gasUsed * receipt.effectiveGasPrice).toString(), explorerUrl: `${PAYMENT_EXPLORER}/tx/${receipt.transactionHash}`};
}
