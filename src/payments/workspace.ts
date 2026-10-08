import {invoiceKey, units, validateInvoice, type Invoice} from "./core";

export type SavedInvoice = {invoice: Invoice; txHash: string};
export type OperatorSettings = {maxPayment: string; dailyBudget: string; gasLimit: string; reserve: string; automatic: boolean; approvalAbove: string; emergencyStop: boolean};
export const DEFAULT_SETTINGS: OperatorSettings = {maxPayment: "1", dailyBudget: "3", gasLimit: "0.1", reserve: "0.05", automatic: false, approvalAbove: "0.1", emergencyStop: false};
export function validateSettings(value: unknown): OperatorSettings {
  const v = value as OperatorSettings;
  if (!v || typeof v.automatic !== "boolean" || typeof v.emergencyStop !== "boolean") throw new Error("Invalid operator settings.");
  [v.maxPayment, v.dailyBudget, v.gasLimit].forEach(n => units(n));
  [v.reserve, v.approvalAbove].forEach(n => units(n, true));
  if (units(v.maxPayment) > units(v.dailyBudget)) throw new Error("Per-payment limit exceeds daily budget.");
  return {maxPayment: v.maxPayment, dailyBudget: v.dailyBudget, gasLimit: v.gasLimit, reserve: v.reserve, automatic: v.automatic, approvalAbove: v.approvalAbove, emergencyStop: v.emergencyStop};
}
// Backups never import a verification result. Every receipt must be checked again against Arc.
export function importInvoices(value: unknown, existing: SavedInvoice[], payer?: string): SavedInvoice[] {
  const input = value as {version?: number; invoices?: unknown};
  const rows: unknown[] = Array.isArray(value) ? value : input?.version === 1 && Array.isArray(input.invoices) ? input.invoices : [value];
  if (!rows.length || rows.length > 50 || existing.length + rows.length > 50) throw new Error("Keep at most 50 invoices in this browser.");
  const keys = new Set(existing.map(s => invoiceKey(s.invoice)));
  const added = rows.map(row => {
    const wrapper = row as {invoice?: unknown; txHash?: unknown};
    const invoice = validateInvoice(wrapper?.invoice ?? row);
    if (invoice.recipient === payer?.toLowerCase()) throw new Error("The payer cannot pay itself.");
    if (keys.has(invoiceKey(invoice))) throw new Error("This vendor/invoice reference is already saved.");
    keys.add(invoiceKey(invoice));
    const txHash = wrapper?.txHash;
    if (txHash !== undefined && txHash !== "" && (typeof txHash !== "string" || !/^0x[\da-f]{64}$/i.test(txHash))) throw new Error("Invalid transaction hash in invoice backup.");
    return {invoice, txHash: typeof txHash === "string" ? txHash : ""};
  });
  return [...added, ...existing];
}
