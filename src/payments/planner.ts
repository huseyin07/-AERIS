import {formatUnits} from "viem";
import {decidePayment, invoiceKey, units, validateInvoice, type Invoice, type PaymentPolicy} from "./core";

export type PlanRow = {key: string; reference: string; amountUsdc: string; action: "hold" | "approval" | "eligible" | "settled"; reason: string};
export function planInvoices(invoices: Invoice[], policy: PaymentPolicy, balanceUsdc: string, settledKeys: Set<string>, now: number) {
  if (invoices.length > 50 || !Number.isFinite(now)) throw new Error("Invalid invoice plan.");
  const balance = units(balanceUsdc, true), gas = units(policy.maxGasUsdc);
  [policy.maxPaymentUsdc, policy.dailyBudgetUsdc].forEach(v => units(v));
  units(policy.reserveUsdc, true); units(policy.approvalAboveUsdc, true);
  if (units(policy.maxPaymentUsdc) > units(policy.dailyBudgetUsdc)) throw new Error("Per-payment limit exceeds daily budget.");
  const valid = invoices.map(validateInvoice).sort((a,b) => Date.parse(a.dueAt)-Date.parse(b.dueAt) || invoiceKey(a).localeCompare(invoiceKey(b)));
  if (new Set(valid.map(invoiceKey)).size !== valid.length) throw new Error("Duplicate vendor/invoice reference in plan.");
  let allocated = 0n, due = 0n, upcoming = 0n;
  const rows: PlanRow[] = valid.map(invoice => {
    const key = invoiceKey(invoice), amount = units(invoice.amountUsdc);
    if (settledKeys.has(key)) return {key, reference: invoice.reference, amountUsdc: invoice.amountUsdc, action: "settled", reason: "Matching Arc receipt verified in this session."};
    const date = Date.parse(invoice.dueAt);
    if (date <= now) due += amount;
    else if (date <= now + 30 * 86400_000) upcoming += amount;
    const decision = decidePayment(invoice, policy, balance - allocated, allocated, gas, now);
    if (decision.action === "hold") return {key, reference: invoice.reference, amountUsdc: invoice.amountUsdc, action: "hold", reason: decision.reason};
    allocated += amount + gas;
    return {key, reference: invoice.reference, amountUsdc: invoice.amountUsdc, action: decision.requiresApproval ? "approval" : "eligible", reason: decision.requiresApproval ? "Fits this plan; operator approval required." : "Fits this plan and the saved automation threshold."};
  });
  const text = (n: bigint) => formatUnits(n,6);
  return {rows, balanceUsdc, dueUsdc:text(due), upcomingUsdc:text(upcoming), allocatedUsdc:text(allocated), remainingUsdc:text(balance-allocated), gasReservePerInvoiceUsdc:policy.maxGasUsdc, checkedAt:new Date(now).toISOString(), scope:"Planning estimate only. Uses the maximum gas allowance per invoice. Prior journal reservations and payments are rechecked by the local runner; this browser plan cannot authorize spending."};
}
