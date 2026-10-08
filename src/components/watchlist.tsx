"use client";

import {useEffect, useMemo, useRef, useState, type FormEvent} from "react";
import type {Transfer} from "@/data/types";
import {ARC} from "@/data/arc";
import {money, short} from "@/lib/format";
import {emptyWatchState, evaluateWatchlist, MAX_WATCHES, parseUsdc, restoreWatchState, WATCHLIST_KEY, type Watch, type WatchState} from "@/watchlist/engine";

export function Watchlist({transfers, reference, healthy, selected, onInspect}: {
  transfers: readonly Transfer[]; reference: number | null; healthy: boolean;
  selected: string | null; onInspect: (address: string) => void;
}) {
  const [state, setState] = useState<WatchState>(emptyWatchState);
  const [ready, setReady] = useState(false);
  const [open, setOpen] = useState(false);
  const [address, setAddress] = useState("");
  const [label, setLabel] = useState("");
  const [large, setLarge] = useState("10000");
  const [recipientCount, setRecipientCount] = useState("5");
  const [largeEnabled, setLargeEnabled] = useState(true);
  const [recipientEnabled, setRecipientEnabled] = useState(true);
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [storageError, setStorageError] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const unread = state.alerts.filter(alert => !alert.read).length;

  useEffect(() => {
    try {setState(restoreWatchState(localStorage.getItem(WATCHLIST_KEY)));}
    catch {setStorageError(true);}
    setReady(true);
  }, []);
  useEffect(() => {
    if (!ready) return;
    try {localStorage.setItem(WATCHLIST_KEY, JSON.stringify(state)); setStorageError(false);}
    catch {setStorageError(true);}
  }, [ready, state]);
  useEffect(() => {
    if (!ready || reference === null) return;
    setState(current => evaluateWatchlist(current, transfers, reference, healthy));
  }, [ready, transfers, reference, healthy]);

  const totals = useMemo(() => new Map(state.watches.map(watch => {
    const related = reference === null ? [] : transfers.filter(t => t.timestamp !== undefined && t.timestamp > reference - 600_000 && t.timestamp <= reference);
    let sent = 0n, received = 0n;
    for (const t of related) {
      const amount = parseUsdc(t.value) ?? 0n;
      if (t.from.toLowerCase() === watch.address) sent += amount;
      if (t.to.toLowerCase() === watch.address) received += amount;
    }
    return [watch.id, {sent: money(String(Number(sent) / 1e6)), received: money(String(Number(received) / 1e6))}];
  })), [state.watches, transfers, reference]);

  function resetForm() {setEditing(null); setAddress(""); setLabel(""); setError("");}
  function submit(event: FormEvent) {
    event.preventDefault();
    const normalized = address.trim().toLowerCase();
    if (!/^0x[\da-f]{40}$/.test(normalized)) {setError("Enter a full 0x wallet or contract address."); return;}
    if (state.watches.some(w => w.address === normalized && w.id !== editing)) {setError("This address is already tracked."); return;}
    if (!editing && state.watches.length >= MAX_WATCHES) {setError(`You can track up to ${MAX_WATCHES} addresses.`); return;}
    if (!largeEnabled && !recipientEnabled) {setError("Enable at least one alert rule."); return;}
    if (largeEnabled && parseUsdc(large.trim()) === null) {setError("Enter a positive USDC amount with up to 6 decimals."); return;}
    const count = Number(recipientCount);
    if (recipientEnabled && (!Number.isInteger(count) || count < 2 || count > 50)) {setError("New recipient threshold must be between 2 and 50."); return;}
    const watch: Watch = {id: editing ?? crypto.randomUUID(), address: normalized, label: label.trim().slice(0, 40),
      enabled: true, largeOutflow: largeEnabled ? large.trim() : null, newRecipientCount: recipientEnabled ? count : null,
      lastReference: null, recipients: [], recipientLimit: false, discoveries: [], seenLarge: [], burstActive: false};
    setState(current => {
      const next = {...current, watches: editing ? current.watches.map(w => w.id === editing ? watch : w) : [...current.watches, watch],
        alerts: editing ? current.alerts.filter(a => a.watchId !== editing) : current.alerts};
      return reference === null ? next : evaluateWatchlist(next, transfers, reference, healthy);
    });
    resetForm();
  }
  function edit(watch: Watch) {
    setEditing(watch.id); setAddress(watch.address); setLabel(watch.label);
    setLarge(watch.largeOutflow ?? "10000"); setLargeEnabled(watch.largeOutflow !== null);
    setRecipientCount(String(watch.newRecipientCount ?? 5)); setRecipientEnabled(watch.newRecipientCount !== null); setError("");
    formRef.current?.scrollIntoView({block: "nearest", behavior: "smooth"});
  }
  function toggle(watch: Watch) {
    setState(current => {
      const next = {...current, watches: current.watches.map(w => w.id === watch.id ? {...w, enabled: !w.enabled, lastReference: null, discoveries: [], burstActive: false} : w)};
      return reference === null ? next : evaluateWatchlist(next, transfers, reference, healthy);
    });
  }

  return <section className="watchlist" id="watchlist" aria-labelledby="watchlist-heading">
    <div className="watchlistHeader">
      <div><h2 id="watchlist-heading">Watchlist & alerts</h2><p>Track addresses. Get transaction-backed alerts.</p></div>
      <span className="watchlistMonitoring" role="status">{ready ? `${state.watches.filter(w => w.enabled).length} tracking · ${healthy ? "Live" : "Waiting for complete live data"}` : "Loading saved addresses…"}</span>
      <button className="watchlistButton" type="button" onClick={() => setOpen(value => !value)} aria-expanded={open} aria-controls="watchlist-content">{open ? "Close watchlist" : "Manage watchlist"}{unread > 0 ? ` · ${unread} unread` : ""}</button>
    </div>
    <p className="watchlistScope">Alerts run while this page is open. Saved on this browser only. No wallet connection needed.</p>
    <div className="watchlistAnnouncement" role="status" aria-live="polite">{unread > 0 ? `${unread} unread alert${unread === 1 ? "" : "s"}. Open the watchlist to inspect transaction evidence.` : ""}</div>
    {open && <div id="watchlist-content" className="watchlistContent">
      {storageError && <p className="watchlistError" role="alert">Browser storage is unavailable. Changes will last only for this page session.</p>}
      <form ref={formRef} className="watchlistForm" onSubmit={submit}>
        <label>Address<input value={address} onChange={e => setAddress(e.target.value)} placeholder="0x… full address" autoComplete="off" spellCheck={false} maxLength={42} required/></label>
        <label>Label (optional)<input value={label} onChange={e => setLabel(e.target.value)} placeholder="Treasury, project, wallet…" maxLength={40}/></label>
        <div className="watchlistRule"><label><input type="checkbox" checked={largeEnabled} onChange={e => setLargeEnabled(e.target.checked)}/>Large outgoing transfer</label><label className="watchlistThreshold">At least USDC<input aria-label="Large outgoing transfer threshold in USDC" value={large} onChange={e => setLarge(e.target.value)} inputMode="decimal" disabled={!largeEnabled}/></label></div>
        <div className="watchlistRule"><label><input type="checkbox" checked={recipientEnabled} onChange={e => setRecipientEnabled(e.target.checked)}/>New recipients within 10 minutes</label><label className="watchlistThreshold">At least recipients<input aria-label="New recipient threshold" type="number" min="2" max="50" value={recipientCount} onChange={e => setRecipientCount(e.target.value)} disabled={!recipientEnabled}/></label></div>
        <p className="watchlistScope">The first scan checks current large outflows and learns recipient history. “New” means first seen while tracking, not first ever. Editing rules restarts this baseline.</p>
        <div className="watchlistActions"><button className="watchlistButton" disabled={!ready} type="submit">{editing ? "Save rules" : "Track address"}</button>{editing && <button className="watchlistButton" type="button" onClick={resetForm}>Cancel edit</button>}{selected && !editing && <button className="watchlistButton" type="button" onClick={() => setAddress(selected)}>Use selected address</button>}</div>
        {error && <p className="watchlistError" role="alert">{error}</p>}
      </form>
      <div className="watchlistAddresses"><h3>Tracked addresses · {state.watches.length}/{MAX_WATCHES}</h3>
        {!state.watches.length && <p>Add a wallet or contract address to start tracking its USDC outflows.</p>}
        {state.watches.map(watch => <article className="watchlistAddress" key={watch.id}>
          <div className="watchlistAddressTitle"><strong>{watch.label || short(watch.address)}</strong><span>{!watch.enabled ? "Paused" : !healthy ? "Waiting for live data" : watch.lastReference === null ? "Learning baseline" : "Monitoring"}</span></div>
          <a href={`${ARC.explorer}/address/${watch.address}`} target="_blank" rel="noopener noreferrer" className="watchlistFullAddress">{watch.address} ↗</a>
          <p>Large outflow: {watch.largeOutflow ? `≥ ${watch.largeOutflow} USDC` : "off"} · New recipients / 10m: {watch.newRecipientCount ?? "off"}</p>
          <p>{healthy ? "Current observed 10m" : "Last observation · may be incomplete"}: sent {totals.get(watch.id)?.sent} · received {totals.get(watch.id)?.received} USDC</p>
          {watch.recipientLimit && <p className="watchlistError">Recipient history limit reached. New-recipient alerts paused; edit rules to restart the baseline.</p>}
          <div className="watchlistActions"><button type="button" onClick={() => onInspect(watch.address)}>Inspect flows</button><button type="button" onClick={() => edit(watch)}>Edit rules</button><button type="button" onClick={() => toggle(watch)}>{watch.enabled ? "Pause" : "Resume"}</button><button type="button" aria-label={`Remove ${watch.label || watch.address} from watchlist`} onClick={() => {setState(current => ({...current, watches: current.watches.filter(w => w.id !== watch.id), alerts: current.alerts.filter(a => a.watchId !== watch.id)})); if (editing === watch.id) resetForm();}}>Remove</button></div>
        </article>)}
      </div>
      <div className="watchlistAlerts"><div className="watchlistAlertHeading"><h3>Alerts · {unread} unread</h3>{state.alerts.length > 0 && <button type="button" onClick={() => setState(current => ({...current, alerts: current.alerts.map(a => ({...a, read: true}))}))}>Mark all read</button>}</div>
        {!state.alerts.length && <p>No matching alerts yet. Monitoring pauses when observations are incomplete or stale.</p>}
        {state.alerts.map(alert => <article className="watchlistAlert" key={alert.id} data-unread={!alert.read}>
          <div className="watchlistAddressTitle"><strong>{alert.label || short(alert.address)} · {alert.kind === "large-outflow" ? "Large outflow" : "New recipients"}</strong><time dateTime={new Date(alert.reference).toISOString()}>{new Date(alert.reference).toLocaleTimeString()}</time></div>
          <p>{alert.kind === "large-outflow" ? `${alert.count} observed outgoing transfer${alert.count === 1 ? "" : "s"} ≥ ${alert.rule} USDC.` : `${alert.count} recipients first seen during tracking within the observed 10-minute window; rule ≥ ${alert.rule}.`}</p>
          <details><summary>View transaction evidence ({alert.evidence.length}{alert.count > alert.evidence.length ? ` of ${alert.count}` : ""})</summary><ul>{alert.evidence.map(t => <li key={`${t.txHash}:${t.logIndex}`}><span>{money(t.value)} USDC → {short(t.to)} · block {t.blockNumber} · log {t.logIndex}</span><a href={`${ARC.explorer}/tx/${t.txHash}`} target="_blank" rel="noopener noreferrer">Verify transaction ↗</a></li>)}</ul></details>
          {!alert.read && <button type="button" onClick={() => setState(current => ({...current, alerts: current.alerts.map(a => a.id === alert.id ? {...a, read: true} : a)}))}>Mark read</button>}
        </article>)}
      </div>
    </div>}
  </section>;
}
