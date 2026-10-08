import type {Transfer} from "../data/types.ts";

export const WATCHLIST_KEY = "aeris.watchlist.v1";
export const MAX_WATCHES = 12;
const WINDOW = 600_000;
const MAX_RECIPIENTS = 2_000;
const ADDRESS = /^0x[0-9a-f]{40}$/i;
export type Watch = {
  id: string; address: string; label: string; enabled: boolean;
  largeOutflow: string | null; newRecipientCount: number | null;
  lastReference: number | null; recipients: string[]; recipientLimit: boolean;
  discoveries: {address: string; timestamp: number; transfer: Transfer}[];
  seenLarge: string[]; burstActive: boolean;
};
export type WatchAlert = {
  id: string; watchId: string; address: string; label: string;
  kind: "large-outflow" | "new-recipients"; reference: number;
  count: number; rule: string; evidence: Transfer[]; read: boolean;
};
export type WatchState = {version: 1; watches: Watch[]; alerts: WatchAlert[]};
export const emptyWatchState = (): WatchState => ({version: 1, watches: [], alerts: []});

export function parseUsdc(value: string): bigint | null {
  if (!/^\d{1,15}(\.\d{1,6})?$/.test(value)) return null;
  const [whole, fraction = ""] = value.split(".");
  const result = BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, "0"));
  return result > 0n ? result : null;
}
const identity = (t: Transfer) => `${t.txHash.toLowerCase()}:${t.logIndex}`;

function validTransfer(t: Transfer) {
  return t && /^0x[\da-f]{64}$/i.test(t.txHash) && ADDRESS.test(t.from) && ADDRESS.test(t.to)
    && Number.isInteger(t.logIndex) && t.logIndex >= 0 && /^\d+$/.test(t.blockNumber)
    && Number.isFinite(t.timestamp) && parseUsdc(t.value) !== null;
}

/** Only fresh, complete Arc observations can advance monitoring or generate alerts. */
export function evaluateWatchlist(state: WatchState, transfers: readonly Transfer[], reference: number, healthy: boolean): WatchState {
  if (!healthy || !Number.isFinite(reference)) return state;
  const window = [...new Map(transfers.filter(t => validTransfer(t) && t.timestamp! > reference - WINDOW && t.timestamp! <= reference).map(t => [identity(t), t])).values()]
    .sort((a, b) => a.timestamp! - b.timestamp! || Number(BigInt(a.blockNumber) - BigInt(b.blockNumber)) || a.logIndex - b.logIndex);
  const generated: WatchAlert[] = [];
  let changed = false;
  const watches = state.watches.map(watch => {
    if (!watch.enabled || (watch.lastReference !== null && reference < watch.lastReference)) return watch;
    changed = true;
    const outgoing = window.filter(t => t.from.toLowerCase() === watch.address && t.to.toLowerCase() !== watch.address);
    const resetBaseline = watch.lastReference === null || reference - watch.lastReference > 120_000;
    const known = new Set(watch.recipients);
    let recipientLimit = watch.recipientLimit;
    let discoveries = resetBaseline ? [] : watch.discoveries.filter(d => d.timestamp > reference - WINDOW);
    for (const transfer of outgoing) {
      const address = transfer.to.toLowerCase();
      if (known.has(address)) continue;
      if (known.size >= MAX_RECIPIENTS) {recipientLimit = true; break;}
      known.add(address);
      if (!resetBaseline) discoveries.push({address, timestamp: transfer.timestamp!, transfer});
    }
    const threshold = watch.largeOutflow ? parseUsdc(watch.largeOutflow) : null;
    const matching = threshold ? outgoing.filter(t => parseUsdc(t.value)! >= threshold) : [];
    const previous = new Set(watch.seenLarge);
    const fresh = matching.filter(t => !previous.has(identity(t)));
    if (fresh.length) generated.push({
      id: `${watch.id}:out:${identity(fresh[fresh.length - 1])}`, watchId: watch.id,
      address: watch.address, label: watch.label, kind: "large-outflow", reference,
      count: fresh.length, rule: watch.largeOutflow!, evidence: fresh.slice(-20).reverse(), read: false,
    });
    const burst = !recipientLimit && watch.newRecipientCount !== null && discoveries.length >= watch.newRecipientCount;
    if (burst && !watch.burstActive) generated.push({
      id: `${watch.id}:recipients:${reference}`, watchId: watch.id, address: watch.address,
      label: watch.label, kind: "new-recipients", reference, count: discoveries.length,
      rule: String(watch.newRecipientCount), evidence: discoveries.slice(-20).map(d => d.transfer).reverse(), read: false,
    });
    return {...watch, lastReference: reference, recipients: [...known], recipientLimit,
      discoveries, seenLarge: matching.map(identity), burstActive: burst};
  });
  const existingAlerts = new Set(state.alerts.map(a => a.id));
  return changed ? {...state, watches, alerts: [...generated.filter(a => !existingAlerts.has(a.id)).reverse(), ...state.alerts].slice(0, 50)} : state;
}

/** Validate browser storage before it can become rules, labels or transaction links. */
export function restoreWatchState(raw: string | null): WatchState {
  if (!raw) return emptyWatchState();
  try {
    const state = JSON.parse(raw);
    if (state.version !== 1 || !Array.isArray(state.watches) || !Array.isArray(state.alerts)) return emptyWatchState();
    const watches: Watch[] = [];
    for (const w of state.watches.slice(0, MAX_WATCHES)) {
      if (!w || typeof w.id !== "string" || w.id.length > 80 || !ADDRESS.test(w.address)
        || (w.largeOutflow !== null && (typeof w.largeOutflow !== "string" || parseUsdc(w.largeOutflow) === null))
        || (w.newRecipientCount !== null && (!Number.isInteger(w.newRecipientCount) || w.newRecipientCount < 2 || w.newRecipientCount > 50))) continue;
      const address = w.address.toLowerCase();
      if (watches.some(v => v.address === address || v.id === w.id)) continue;
      watches.push({id: w.id, address, label: typeof w.label === "string" ? w.label.slice(0, 40) : "",
        enabled: w.enabled !== false, largeOutflow: w.largeOutflow, newRecipientCount: w.newRecipientCount,
        lastReference: Number.isFinite(w.lastReference) && w.lastReference > 0 && w.lastReference < 8.64e15 ? w.lastReference : null,
        recipients: Array.isArray(w.recipients) ? [...new Set<string>(w.recipients.filter((a: unknown) => typeof a === "string" && ADDRESS.test(a)).map((a: string) => a.toLowerCase()))].slice(0, MAX_RECIPIENTS) : [],
        recipientLimit: w.recipientLimit === true, discoveries: Array.isArray(w.discoveries) ? w.discoveries.filter((d: Watch["discoveries"][number]) => d && ADDRESS.test(d.address) && Number.isFinite(d.timestamp) && validTransfer(d.transfer)).slice(-MAX_RECIPIENTS) : [],
        seenLarge: Array.isArray(w.seenLarge) ? w.seenLarge.filter((id: unknown) => typeof id === "string" && /^0x[\da-f]{64}:\d+$/i.test(id)).slice(-20_000) : [], burstActive: w.burstActive === true});
    }
    const alerts: WatchAlert[] = state.alerts.filter((a: WatchAlert) => a && typeof a.id === "string" && a.id.length < 200
      && watches.some(w => w.id === a.watchId) && ADDRESS.test(a.address) && typeof a.label === "string" && a.label.length <= 40
      && ["large-outflow", "new-recipients"].includes(a.kind) && Number.isFinite(a.reference) && a.reference > 0 && a.reference < 8.64e15
      && Number.isInteger(a.count) && a.count > 0 && typeof a.rule === "string" && /^\d+(\.\d{1,6})?$/.test(a.rule)
      && Array.isArray(a.evidence) && a.evidence.length > 0 && a.evidence.every(validTransfer))
      .slice(0, 50).map((a: WatchAlert) => ({...a, evidence: a.evidence.slice(0, 20), read: a.read === true}));
    return {version: 1, watches, alerts};
  } catch {return emptyWatchState();}
}
