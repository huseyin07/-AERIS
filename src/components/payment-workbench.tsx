"use client";

import {useEffect, useState, type FormEvent} from "react";
import type {AgentWalletStatus} from "@/circle/wallet-types";
import {PAYMENT_EXPLORER, units, validateInvoice, validatePolicy, type Invoice, type PaymentPolicy} from "@/payments/core";

type SavedInvoice = {invoice: Invoice; txHash: string};
type Settlement = {status: string; message: string; txHash?: string; blockNumber?: string; logIndex?: number; explorerUrl?: string; payer?: string; amountUsdc?: string};
const KEY = "aeris.invoices.v1";
function download(name: string, data: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], {type: "application/json"}));
  const link = document.createElement("a"); link.href = url; link.download = name; link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function PaymentWorkbench() {
  const [wallet, setWallet] = useState<AgentWalletStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const [saved, setSaved] = useState<SavedInvoice[]>([]);
  const [ready, setReady] = useState(false);
  const [storageError, setStorageError] = useState(false);
  const [reference, setReference] = useState("");
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("0.1");
  const [purpose, setPurpose] = useState("");
  const [due, setDue] = useState("");
  const [error, setError] = useState("");
  const [checking, setChecking] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, Settlement>>({});
  const [automatic, setAutomatic] = useState(false);
  const [approvalAbove, setApprovalAbove] = useState("0.1");
  const [maxPayment, setMaxPayment] = useState("1");
  const [dailyBudget, setDailyBudget] = useState("3");
  const [gasLimit, setGasLimit] = useState("0.1");
  const [reserve, setReserve] = useState("0.05");
  useEffect(() => {
    try {
      const raw = JSON.parse(localStorage.getItem(KEY) ?? "[]");
      if (Array.isArray(raw)) setSaved(raw.slice(0, 50).flatMap(item => {
        try {return [{invoice: validateInvoice(item.invoice), txHash: typeof item.txHash === "string" && /^0x[\da-f]{64}$/i.test(item.txHash) ? item.txHash : ""}];} catch {return [];}
      }));
    } catch {setStorageError(true);}
    setReady(true);
  }, []);
  useEffect(() => {if (ready) try {localStorage.setItem(KEY, JSON.stringify(saved));} catch {setStorageError(true);}}, [ready, saved]);
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    const timeout = window.setTimeout(() => controller.abort(), 25_000);
    setLoading(true); setWallet(null);
    fetch("/api/agent-wallet", {cache: "no-store", signal: controller.signal}).then(r => r.json()).then(value => {if (active) setWallet(value);}).catch(() => {if (active) setWallet(null);}).finally(() => {window.clearTimeout(timeout); if (active) setLoading(false);});
    return () => {active = false; controller.abort(); window.clearTimeout(timeout);};
  }, [revision]);
  function save(event: FormEvent) {
    event.preventDefault(); setError("");
    try {
      if (saved.length >= 50) throw new Error("This browser already holds 50 invoices.");
      const invoice = validateInvoice({version: 1, chainId: 5042, reference: reference.trim(), recipient: recipient.trim(), amountUsdc: amount.trim(), dueAt: due ? new Date(due).toISOString() : "", purpose: purpose.trim()});
      if (invoice.recipient === wallet?.address?.toLowerCase()) throw new Error("Choose a recipient other than the payer wallet.");
      if (saved.some(s => s.invoice.reference === invoice.reference && s.invoice.recipient === invoice.recipient)) throw new Error("This vendor/invoice reference is already saved.");
      setSaved(current => [{invoice, txHash: ""}, ...current]); setReference(""); setPurpose("");
    } catch (e) {setError(e instanceof Error ? e.message : "Check the invoice fields.");}
  }
  function exportPolicy() {
    setError("");
    try {
      if (wallet?.status !== "verified" || !wallet.address || !saved.length) throw new Error("Verify the payer and save at least one invoice first.");
      const max = units(maxPayment), budget = units(dailyBudget); units(gasLimit); units(reserve, true); units(approvalAbove, true);
      if (max > budget) throw new Error("Per-payment limit exceeds daily budget.");
      const policy: PaymentPolicy = {version: 1, walletId: "", payer: wallet.address as `0x${string}`, allowedRecipients: [...new Set(saved.map(s => s.invoice.recipient))], maxPaymentUsdc: maxPayment, dailyBudgetUsdc: dailyBudget, maxGasUsdc: gasLimit, reserveUsdc: reserve, autoPay: automatic, approvalAboveUsdc: approvalAbove, emergencyStop: false};
      // The public wallet endpoint intentionally omits account identifiers. The runner configuration endpoint supplies only the configured wallet's non-secret ID.
      fetch("/api/payments/config", {cache: "no-store"}).then(async r => {if (!r.ok) throw new Error("Operator configuration is unavailable."); return r.json();}).then(config => {if (config.address.toLowerCase() !== policy.payer.toLowerCase()) throw new Error("Payer identity changed. Refresh verification."); policy.walletId = config.walletId; download("policy.json", validatePolicy(policy));}).catch(e => setError(e.message));
    } catch (e) {setError(e instanceof Error ? e.message : "Invalid policy.");}
  }
  async function verify(item: SavedInvoice) {
    const id = `${item.invoice.recipient}:${item.invoice.reference}`;
    setChecking(id); setResults(current => ({...current, [id]: {status: "checking", message: "Checking Circle payer identity and Arc settlement…"}}));
    try {
      if (!/^0x[\da-f]{64}$/i.test(item.txHash)) throw new Error("Enter the transaction hash returned by the Circle runner.");
      if (saved.some(s => s !== item && s.txHash.toLowerCase() === item.txHash.toLowerCase())) throw new Error("This transaction hash is already assigned to another invoice. One payment cannot settle two invoices.");
      const q = new URLSearchParams({hash: item.txHash, recipient: item.invoice.recipient, amount: item.invoice.amountUsdc});
      const r = await fetch(`/api/payments/verify?${q}`, {cache: "no-store", signal: AbortSignal.timeout(25_000)});
      const result = await r.json();
      setResults(current => ({...current, [id]: result}));
    } catch (e) {setResults(current => ({...current, [id]: {status: "unverified", message: e instanceof Error && e.name !== "TimeoutError" ? e.message : "Verification is unavailable. No payment is marked settled."}}));}
    finally {setChecking(null);}
  }
  return <>
    <section className="buildCard paymentPayer"><h2>Circle treasury wallet</h2><strong role="status">{loading ? "Verifying payer…" : wallet?.status === "verified" ? "Circle identity verified" : "Payer verification unavailable"}</strong>
      {wallet?.status === "verified" && <><p><a href={wallet.explorerUrl} target="_blank" rel="noopener noreferrer">{wallet.address} ↗</a></p><p>{wallet.balanceUsdc} USDC · Arc block {wallet.blockNumber}</p>{wallet.balanceUsdc === "0" && <p className="paymentHold">Funding required before this wallet can pay an invoice or gas on Arc Mainnet.</p>}</>}
      <button className="buildButton" disabled={loading} onClick={() => setRevision(v => v + 1)}>Refresh payer</button>
    </section>
    <section className="buildCard"><h2>1 · Add an invoice</h2><form className="paymentForm" onSubmit={save}>
      <label>Invoice reference<input required maxLength={64} placeholder="INV-001" value={reference} onChange={e => setReference(e.target.value)}/></label>
      <label>USDC amount<input required inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)}/></label>
      <label className="paymentWide">Recipient on Arc Mainnet<input required maxLength={42} placeholder="0x… full recipient address" value={recipient} onChange={e => setRecipient(e.target.value)} spellCheck={false}/></label>
      <label>Due date<input required type="datetime-local" value={due} onChange={e => setDue(e.target.value)}/></label>
      <label>Payment purpose<input required maxLength={160} placeholder="Contractor invoice, service fee…" value={purpose} onChange={e => setPurpose(e.target.value)}/></label>
      <button className="buildButton" disabled={!ready} type="submit">Save invoice</button>
    </form></section>
    <section className="buildCard"><h2>2 · Set operator limits</h2><div className="paymentForm">
      <label>Maximum payment · USDC<input value={maxPayment} inputMode="decimal" onChange={e => setMaxPayment(e.target.value)}/></label><label>Daily budget including gas · USDC<input value={dailyBudget} inputMode="decimal" onChange={e => setDailyBudget(e.target.value)}/></label>
      <label>Maximum gas per payment · USDC<input value={gasLimit} inputMode="decimal" onChange={e => setGasLimit(e.target.value)}/></label><label>Keep treasury reserve · USDC<input value={reserve} inputMode="decimal" onChange={e => setReserve(e.target.value)}/></label>
      <label className="paymentToggle"><input type="checkbox" checked={automatic} onChange={e => setAutomatic(e.target.checked)}/>Auto-pay due invoices inside the saved policy</label><label>Human approval above · USDC<input disabled={!automatic} value={approvalAbove} inputMode="decimal" onChange={e => setApprovalAbove(e.target.value)}/></label>
      <button className="buildButton" disabled={wallet?.status !== "verified" || !saved.length} onClick={exportPolicy}>Download operator policy</button>
    </div><p className="buildMuted">Only saved invoice recipients enter the allowlist. These settings become spending authority only after the operator reviews and saves them in the local runner. Default: approve every payment.</p></section>
    <section className="buildCard"><h2>3 · Run the Circle payment agent</h2><p>Download the runner once. It asks for your existing Circle credentials privately in your terminal, checks the saved policy and live balances, then signs and verifies the payment.</p>
      <div className="buildLinks"><a href="/aeris-circle-runner.zip" download>Download Circle runner ↧</a><a href="https://github.com/huseyin07/-AERIS/blob/codex/wallet-watchlist-alerts/docs/circle-payments.md" target="_blank" rel="noopener noreferrer">Setup & recovery guide ↗</a></div>
      <pre className="paymentCommands">{"cd ~/Downloads/aeris-circle-runner\nnpm install\nnpm run circle:pay -- configure ~/Downloads/policy.json\nnpm run circle:pay -- pay ~/Downloads/invoice.json\nnpm run circle:pay -- pay ~/Downloads/invoice.json --execute"}</pre>
      <p className="buildMuted">Run inside the extracted runner folder. Preview sends nothing. Execution requires local approval unless the operator enabled auto-pay below a limit. Keep one journal and one active runner for this dedicated wallet; pending invoices block a new nonce.</p></section>
    <section className="buildCard"><h2>Invoices & settlement evidence</h2>{!saved.length && <p>No invoices yet.</p>}{saved.map(item => {
      const id = `${item.invoice.recipient}:${item.invoice.reference}`; const result = results[id];
      return <article className="paymentInvoice" key={id}><h3>{item.invoice.reference} · {item.invoice.amountUsdc} USDC</h3><p>{item.invoice.purpose}</p><p>Recipient: <a href={`${PAYMENT_EXPLORER}/address/${item.invoice.recipient}`} target="_blank" rel="noopener noreferrer">{item.invoice.recipient} ↗</a></p><p>Due: {new Date(item.invoice.dueAt).toLocaleString()} · {result?.status === "verified" ? "Settlement verified" : Date.parse(item.invoice.dueAt) > Date.now() ? "Hold · not due yet" : "Due · agent must check live liquidity and policy"}</p>
        <button className="buildButton" onClick={() => download("invoice.json", item.invoice)}>Download payment plan</button>
        <label className="paymentHash">Transaction hash from runner<input value={item.txHash} placeholder="0x… transaction hash" spellCheck={false} maxLength={66} onChange={e => {setSaved(current => current.map(s => s.invoice.reference === item.invoice.reference && s.invoice.recipient === item.invoice.recipient ? {...s, txHash: e.target.value} : s)); setResults(current => ({...current, [id]: {status: "unverified", message: "Hash changed; verify the receipt again."}}));}}/></label>
        <button className="buildButton" disabled={checking !== null || !item.txHash} onClick={() => verify(item)}>{checking === id ? "Verifying…" : "Verify Arc settlement"}</button>
        {result && <div className={result.status === "verified" ? "paymentVerified" : "paymentHold"} role="status"><p>{result.message}</p>{result.status === "verified" && <><p>Block {result.blockNumber} · USDC log {result.logIndex}</p><a href={result.explorerUrl} target="_blank" rel="noopener noreferrer">Open confirmed transaction ↗</a></>}</div>}
      </article>;
    })}</section>
    {error && <p className="paymentHold" role="alert">{error}</p>}{storageError && <p className="paymentHold" role="alert">Browser storage is unavailable. Download each invoice before leaving.</p>}
  </>;
}
