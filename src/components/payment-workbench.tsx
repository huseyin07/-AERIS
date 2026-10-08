"use client";

import {useEffect, useRef, useState, type FormEvent, type ChangeEvent} from "react";
import type {AgentWalletStatus} from "@/circle/wallet-types";
import {PAYMENT_EXPLORER, invoiceKey, validateInvoice, validatePolicy, type PaymentPolicy} from "@/payments/core";

import {planInvoices} from "@/payments/planner";

import {DEFAULT_SETTINGS, importInvoices, validateSettings, type SavedInvoice} from "@/payments/workspace";
type Settlement = {chainId?: number; recipient?: string; checkedAt?: string; gasCostNativeUnits?: string; status: string; message: string; txHash?: string; blockNumber?: string; logIndex?: number; explorerUrl?: string; payer?: string; amountUsdc?: string};
const KEY = "aeris.invoices.v1";
const SETTINGS_KEY = "aeris.payment-settings.v1";
function download(name: string, data: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], {type: "application/json"}));
  const link = document.createElement("a"); link.href = url; link.download = name; link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function PaymentWorkbench() {
  const activeHashes = useRef<Record<string, string>>({});
  const [now, setNow] = useState(() => Date.now());
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
  const [emergencyStop, setEmergencyStop] = useState(false);
  const [notice, setNotice] = useState("");
  const [policyLoading, setPolicyLoading] = useState(false);
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
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      const settings = raw ? validateSettings(JSON.parse(raw)) : DEFAULT_SETTINGS;
      setMaxPayment(settings.maxPayment); setDailyBudget(settings.dailyBudget); setGasLimit(settings.gasLimit);
      setReserve(settings.reserve); setAutomatic(settings.automatic); setApprovalAbove(settings.approvalAbove); setEmergencyStop(settings.emergencyStop);
    } catch {setStorageError(true);}
    setReady(true);
  }, []);
  useEffect(() => {if (ready) try {localStorage.setItem(KEY, JSON.stringify(saved));} catch {setStorageError(true);}}, [ready, saved]);
  useEffect(() => {
    if (!ready) return;
    try {
      const settings = validateSettings({maxPayment, dailyBudget, gasLimit, reserve, automatic, approvalAbove, emergencyStop});
      try {localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));} catch {setStorageError(true);}
    } catch { /* Incomplete edits do not overwrite the last valid saved settings. */ }
  }, [ready, maxPayment, dailyBudget, gasLimit, reserve, automatic, approvalAbove, emergencyStop]);
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    const timeout = window.setTimeout(() => controller.abort(), 25_000);
    setLoading(true); setWallet(null);
    fetch("/api/agent-wallet", {cache: "no-store", signal: controller.signal}).then(r => r.json()).then(value => {if (active) {setWallet(value); setNow(Date.now());}}).catch(() => {if (active) setWallet(null);}).finally(() => {window.clearTimeout(timeout); if (active) setLoading(false);});
    return () => {active = false; controller.abort(); window.clearTimeout(timeout);};
  }, [revision]);
  useEffect(() => {const timer = window.setInterval(() => setNow(Date.now()), 30_000); return () => window.clearInterval(timer);}, []);
  function save(event: FormEvent) {
    event.preventDefault(); setError(""); setNotice("");
    try {
      if (saved.length >= 50) throw new Error("This browser already holds 50 invoices.");
      const invoice = validateInvoice({version: 1, chainId: 5042, reference: reference.trim(), recipient: recipient.trim(), amountUsdc: amount.trim(), dueAt: due ? new Date(due).toISOString() : "", purpose: purpose.trim()});
      if (invoice.recipient === wallet?.address?.toLowerCase()) throw new Error("Choose a recipient other than the payer wallet.");
      if (saved.some(s => s.invoice.reference === invoice.reference && s.invoice.recipient === invoice.recipient)) throw new Error("This vendor/invoice reference is already saved.");
      setSaved(current => [{invoice, txHash: ""}, ...current]); setReference(""); setPurpose(""); setNotice("Invoice saved. Review its liquidity decision below.");
    } catch (e) {setError(e instanceof Error ? e.message : "Check the invoice fields.");}
  }
  async function importFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; event.target.value = "";
    if (!file) return;
    setError(""); setNotice("");
    try {
      if (file.size > 100_000) throw new Error("Invoice JSON must be smaller than 100 KB.");
      const value = JSON.parse(await file.text());
      importInvoices(value, saved, wallet?.address);
      setSaved(current => {
        // Parsing was checked below before React schedules this update.
        try {return importInvoices(value, current, wallet?.address);} catch {return current;}
      });
      setNotice("Invoices imported. Any saved transaction hashes still need a fresh Arc receipt check.");
    } catch (e) {setError(e instanceof Error ? e.message : "Choose a valid AERIS invoice JSON file.");}
  }
  async function exportPolicy() {
    setError(""); setPolicyLoading(true);
    try {
      if (wallet?.status !== "verified" || !wallet.address || !saved.length) throw new Error("Verify the payer and save at least one invoice first.");
      validateSettings({maxPayment, dailyBudget, gasLimit, reserve, automatic, approvalAbove, emergencyStop});
      const policy: PaymentPolicy = {version: 1, walletId: "", payer: wallet.address as `0x${string}`, allowedRecipients: [...new Set(saved.map(s => s.invoice.recipient))], maxPaymentUsdc: maxPayment, dailyBudgetUsdc: dailyBudget, maxGasUsdc: gasLimit, reserveUsdc: reserve, autoPay: automatic, approvalAboveUsdc: approvalAbove, emergencyStop};
      const response = await fetch("/api/payments/config", {cache: "no-store", signal: AbortSignal.timeout(25_000)});
      if (!response.ok) throw new Error("Operator configuration is unavailable.");
      const config = await response.json();
      if (config.address.toLowerCase() !== policy.payer.toLowerCase()) throw new Error("Payer identity changed. Refresh verification.");
      policy.walletId = config.walletId; download("policy.json", validatePolicy(policy));
    } catch (e) {setError(e instanceof Error ? e.message : "Invalid policy.");}
    finally {setPolicyLoading(false);}
  }
  async function verify(item: SavedInvoice) {
    const id = `${item.invoice.recipient}:${item.invoice.reference}`;
    const expectedHash = item.txHash.toLowerCase(); activeHashes.current[id] = expectedHash;
    setChecking(id); setResults(current => ({...current, [id]: {status: "checking", message: "Checking Circle payer identity and Arc settlement…"}}));
    try {
      if (!/^0x[\da-f]{64}$/i.test(item.txHash)) throw new Error("Enter the transaction hash returned by the Circle runner.");
      if (saved.some(s => s !== item && s.txHash.toLowerCase() === item.txHash.toLowerCase())) throw new Error("This transaction hash is already assigned to another invoice. One payment cannot settle two invoices.");
      const q = new URLSearchParams({hash: item.txHash, recipient: item.invoice.recipient, amount: item.invoice.amountUsdc});
      const r = await fetch(`/api/payments/verify?${q}`, {cache: "no-store", signal: AbortSignal.timeout(25_000)});
      const result = await r.json();
      if (activeHashes.current[id] === expectedHash) setResults(current => ({...current, [id]: result}));
    } catch (e) {if (activeHashes.current[id] === expectedHash) setResults(current => ({...current, [id]: {status: "unverified", message: e instanceof Error && e.name !== "TimeoutError" ? e.message : "Verification is unavailable. No payment is marked settled."}}));}
    finally {setChecking(null);}
  }
  let plan: ReturnType<typeof planInvoices> | null = null;
  let planError = "";
  if (saved.length && wallet?.status === "verified" && wallet.address && wallet.balanceUsdc && wallet.checkedAt && now - wallet.checkedAt >= 0 && now - wallet.checkedAt < 120_000) {
    try {
      plan = planInvoices(saved.map(s => s.invoice), {version: 1, walletId: "", payer: wallet.address as `0x${string}`, allowedRecipients: [...new Set(saved.map(s => s.invoice.recipient))], maxPaymentUsdc: maxPayment, dailyBudgetUsdc: dailyBudget, maxGasUsdc: gasLimit, reserveUsdc: reserve, autoPay: automatic, approvalAboveUsdc: approvalAbove, emergencyStop}, wallet.balanceUsdc, new Set(saved.filter(s => results[invoiceKey(s.invoice)]?.status === "verified" && results[invoiceKey(s.invoice)]?.txHash?.toLowerCase() === s.txHash.toLowerCase()).map(s => invoiceKey(s.invoice))), now);
    } catch (e) {planError = e instanceof Error ? e.message : "Check the spending limits.";}
  }
  const verifiedCount = saved.filter(item => results[invoiceKey(item.invoice)]?.status === "verified" && results[invoiceKey(item.invoice)]?.txHash?.toLowerCase() === item.txHash.toLowerCase()).length;
  return <>
    <nav className="paymentSteps" aria-label="Invoice workflow"><a href="#invoice-entry"><span>1</span>Add invoice</a><a href="#liquidity-plan"><span>2</span>Review decision</a><a href="#settlement-evidence"><span>3</span>Verify payment</a></nav>
    <p className="buildMuted paymentScope">Operator workspace · invoices stay in this browser · Circle signs through your local runner.</p>
    {error && <p className="paymentHold paymentNotice" role="alert">{error}</p>}{notice && <p className="paymentVerified paymentNotice" role="status">{notice}</p>}
    <section className="buildCard paymentPayer"><div><small>TREASURY · ARC MAINNET</small><h2>{wallet?.status === "verified" ? `${wallet.balanceUsdc} USDC available` : "Circle treasury wallet"}</h2><strong role="status">{loading ? "Verifying payer…" : wallet?.status === "verified" ? "Circle identity verified" : "Payer verification unavailable"}</strong>
      {wallet?.status === "verified" && <><p><a href={wallet.explorerUrl} target="_blank" rel="noopener noreferrer">{wallet.address} ↗</a></p><p className="buildMuted">Arc block {wallet.blockNumber} · {saved.length} invoices · {verifiedCount} receipts verified this session</p>{wallet.balanceUsdc === "0" && <p className="paymentHold">Funding required before this wallet can pay an invoice or gas on Arc Mainnet.</p>}</>}
      </div><button className="buildButton" disabled={loading} onClick={() => setRevision(v => v + 1)}>Refresh payer</button>
    </section>
    <section className="buildCard" id="invoice-entry"><div className="buildCardHeading"><h2>1 · Add an invoice</h2><label className="paymentImport">Import invoice JSON<input type="file" accept=".json,application/json" onChange={importFile} disabled={!ready}/></label></div><form className="paymentForm" onSubmit={save}>
      <label>Invoice reference<input required maxLength={64} placeholder="INV-001" value={reference} onChange={e => setReference(e.target.value)}/></label>
      <label>USDC amount<input required inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)}/></label>
      <label className="paymentWide">Recipient on Arc Mainnet<input required maxLength={42} placeholder="0x… full recipient address" value={recipient} onChange={e => setRecipient(e.target.value)} spellCheck={false}/></label>
      <label>Due date<input required type="datetime-local" value={due} onChange={e => setDue(e.target.value)}/></label>
      <label>Payment purpose<input required maxLength={160} placeholder="Contractor invoice, service fee…" value={purpose} onChange={e => setPurpose(e.target.value)}/></label>
      <button className="buildButton" disabled={!ready} type="submit">Save invoice</button>
    </form></section>
    <details className="buildCard paymentDetails"><summary><span>Spending limits</span><small>{emergencyStop ? "All new payments paused" : automatic ? "Local automation enabled" : "Approve every payment"}</small></summary><div className="paymentForm">
      <label>Maximum payment · USDC<input value={maxPayment} inputMode="decimal" onChange={e => setMaxPayment(e.target.value)}/></label><label>Daily budget including gas · USDC<input value={dailyBudget} inputMode="decimal" onChange={e => setDailyBudget(e.target.value)}/></label>
      <label>Maximum gas per payment · USDC<input value={gasLimit} inputMode="decimal" onChange={e => setGasLimit(e.target.value)}/></label><label>Keep treasury reserve · USDC<input value={reserve} inputMode="decimal" onChange={e => setReserve(e.target.value)}/></label>
      <label className="paymentToggle"><input type="checkbox" checked={emergencyStop} onChange={e => setEmergencyStop(e.target.checked)}/>Pause all new payments in this policy</label>
      <label className="paymentToggle"><input type="checkbox" checked={automatic} onChange={e => setAutomatic(e.target.checked)}/>Allow local auto-pay below the approval threshold</label><label>Human approval above · USDC<input disabled={!automatic} value={approvalAbove} inputMode="decimal" onChange={e => setApprovalAbove(e.target.value)}/></label>
      <button className="buildButton" disabled={policyLoading || wallet?.status !== "verified" || !saved.length} onClick={exportPolicy}>{policyLoading ? "Preparing…" : "Download operator policy"}</button>
    </div><p className="buildMuted">Only saved invoice recipients enter the allowlist. These settings become spending authority only after the operator reviews and saves them in the local runner. Default: approve every payment. Settings are saved in this browser; changing or pausing them does not change a previously configured runner until its policy is downloaded and configured again.</p></details>
    <section className="buildCard" id="liquidity-plan"><div className="buildCardHeading"><h2>2 · Agent liquidity plan</h2><span className="buildBadge">DECISION PREVIEW</span></div>
      {!saved.length ? <p>Save an invoice to compare obligations with the verified treasury balance.</p> : !plan ? <p className="paymentHold" role="status">{planError || "Refresh payer verification to assess current liquidity."}</p> : <>
        <dl className="buildFacts"><div><dt>Due now</dt><dd>{plan.dueUsdc} USDC</dd></div><div><dt>Next 30 days</dt><dd>{plan.upcomingUsdc} USDC</dd></div><div><dt>Payments + maximum gas</dt><dd>{plan.allocatedUsdc} USDC</dd></div><div><dt>Balance after this plan</dt><dd>{plan.remainingUsdc} USDC</dd></div></dl>
        {plan.rows.map(row => <div className="paymentDecision" key={row.key}><strong>{row.reference}<small>{row.amountUsdc} USDC</small></strong><div><span className={`paymentDecisionStatus ${row.action}`}>{row.action === "approval" ? "Approval required" : row.action === "eligible" ? "Ready for local runner" : row.action === "settled" ? "Receipt verified" : "On hold"}</span><p>{row.reason}</p></div></div>)}
        <p className="buildMuted">{plan.scope} Oldest due invoices are considered first.</p>
        <button className="buildButton" onClick={() => download("aeris-decision-plan.json", {...plan, chainId: 5042, payer: wallet?.address, balanceBlock: wallet?.blockNumber, invoices: saved.map(s => s.invoice)})}>Download decision evidence</button>
      </>}
    </section>
    <details className="buildCard paymentDetails" id="circle-runner"><summary><span>Execute with Circle</span><small>One-time local setup & payment commands</small></summary><p>Download the runner once. It asks for your existing Circle credentials privately in your terminal, checks the saved policy and live balances, then signs and verifies the payment.</p>
      <div className="buildLinks"><a href="/aeris-circle-runner.zip" download>Download Circle runner ↧</a><a href="https://github.com/huseyin07/-AERIS/blob/main/docs/circle-payments.md" target="_blank" rel="noopener noreferrer">Setup & recovery guide ↗</a></div>
      <pre className="paymentCommands">{"cd ~/Downloads/aeris-circle-runner\nnpm install\nnpm run circle:pay -- configure ~/Downloads/policy.json\nnpm run circle:pay -- pay ~/Downloads/invoice.json\nnpm run circle:pay -- pay ~/Downloads/invoice.json --execute"}</pre>
      <p className="buildMuted">Run inside the extracted runner folder. Preview sends nothing. Execution requires local approval unless the operator enabled auto-pay below a limit. Keep one journal and one active runner for this dedicated wallet; pending invoices block a new nonce.</p></details>
    <section className="buildCard" id="settlement-evidence"><div className="buildCardHeading"><h2>3 · Invoices & settlement evidence</h2>{saved.length > 0 && <button className="buildButton" onClick={() => download("aeris-invoices.json", {version: 1, chainId: 5042, invoices: saved})}>Back up invoices</button>}</div>{!saved.length && <p>Your saved invoices will appear here. A transaction hash alone never marks an invoice paid.</p>}{saved.map(item => {
      const id = invoiceKey(item.invoice); const result = results[id];
      const verified = result?.status === "verified" && result.txHash?.toLowerCase() === item.txHash.toLowerCase();
      return <article className="paymentInvoice" key={id}><h3>{item.invoice.reference} · {item.invoice.amountUsdc} USDC</h3><p>{item.invoice.purpose}</p><p>Recipient: <a href={`${PAYMENT_EXPLORER}/address/${item.invoice.recipient}`} target="_blank" rel="noopener noreferrer">{item.invoice.recipient} ↗</a></p><p>Due: {new Date(item.invoice.dueAt).toLocaleString()} · {verified ? "Settlement verified" : Date.parse(item.invoice.dueAt) > now ? "Hold · not due yet" : "Due · agent must check live liquidity and policy"}</p>
        <button className="buildButton" onClick={() => download("invoice.json", item.invoice)}>Download invoice</button>
        <details className="paymentReceipt"><summary>{verified ? "View verified receipt" : "Check a completed payment"}</summary>
        <label className="paymentHash">Transaction hash from runner<input value={item.txHash} placeholder="0x… transaction hash" spellCheck={false} maxLength={66} onChange={e => {activeHashes.current[id] = e.target.value.toLowerCase(); setSaved(current => current.map(s => s.invoice.reference === item.invoice.reference && s.invoice.recipient === item.invoice.recipient ? {...s, txHash: e.target.value} : s)); setResults(current => ({...current, [id]: {status: "unverified", message: "Hash changed; verify the receipt again."}}));}}/></label>
        <button className="buildButton" disabled={checking !== null || !item.txHash} onClick={() => verify(item)}>{checking === id ? "Verifying…" : "Verify Arc settlement"}</button>
        {result && <div className={verified ? "paymentVerified" : "paymentHold"} role="status"><p>{result.message}</p>{verified && <><button className="buildButton" onClick={() => download("aeris-settlement.json", {version: 1, invoice: item.invoice, evidence: result, note: "Verified by the AERIS receipt endpoint at checkedAt; recheck against Arc independently."})}>Download verified receipt</button><p>Block {result.blockNumber} · USDC log {result.logIndex}</p><a href={result.explorerUrl} target="_blank" rel="noopener noreferrer">Open confirmed transaction ↗</a></>}</div>}</details>
      </article>;
    })}</section>
    {storageError && <p className="paymentHold" role="alert">Some browser data could not be restored or saved. Download an invoice backup before leaving.</p>}
  </>;
}
