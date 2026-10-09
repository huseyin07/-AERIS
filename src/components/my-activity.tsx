"use client";
import Link from "next/link";
import {useCallback,useEffect,useMemo,useRef,useState} from "react";
import {formatUnits} from "viem";
import {LiveActivity} from "./live-activity";
import {Watchlist} from "./watchlist";
import {useActivity} from "@/state/activity-store";
import {ARC} from "@/data/arc";
import type {Transfer} from "@/data/types";
import {activityTotals} from "@/activity/history";
import {parseUsdc,type WatchState,emptyWatchState} from "@/watchlist/engine";
const ALERT_KEY="aeris.activity.dismissed.v1";
type ArchivePage={transfers:Transfer[];coverage:{from:number;to:number}[];nextCursor:string|null;retentionDays:number};
export function MyActivity(){
 const live=useActivity(s=>s.transfers),reference=useActivity(s=>s.observationReferenceTimestamp),health=useActivity(s=>s.health),connection=useActivity(s=>s.connection);
 const [selected,setSelected]=useState(""),[input,setInput]=useState(""),[range,setRange]=useState(24),[watches,setWatches]=useState<WatchState>(emptyWatchState),[history,setHistory]=useState<Transfer[]>([]),[coverage,setCoverage]=useState<ArchivePage["coverage"]>([]),[cursor,setCursor]=useState<string|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(""),[scanned,setScanned]=useState(false),[dismissed,setDismissed]=useState<string[]>([]),[storageError,setStorageError]=useState(false);
 const requestRef=useRef<AbortController|null>(null),bounds=useRef({since:0,until:0}),generation=useRef(0);
 const healthy=connection==="live"&&health.windowCovered===true&&health.status!=="partial";
 const onState=useCallback((state:WatchState)=>setWatches(state),[]);
 useEffect(()=>{try{const raw=JSON.parse(localStorage.getItem(ALERT_KEY)??"[]");if(Array.isArray(raw))setDismissed(raw.filter(v=>typeof v==="string").slice(-2000));}catch{setStorageError(true);}const address=new URLSearchParams(location.search).get("address");if(address&&/^0x[\da-f]{40}$/i.test(address)){setSelected(address.toLowerCase());setInput(address);}return()=>requestRef.current?.abort();},[]);
 const load=useCallback(async(address:string,older:boolean=false,olderCursor?:string)=>{
  requestRef.current?.abort();const controller=new AbortController();requestRef.current=controller;const id=++generation.current;
  if(!older){bounds.current={until:Date.now(),since:Date.now()-range*3600_000};setHistory([]);setCoverage([]);setCursor(null);setScanned(false);}
  setBusy(true);setError("");const timer=setTimeout(()=>controller.abort(),55000);
  try{const q=new URLSearchParams({address,since:String(bounds.current.since),until:String(bounds.current.until)});if(older&&olderCursor)q.set("cursor",olderCursor);
   const r=await fetch(`/api/activity/history?${q}`,{signal:controller.signal,cache:"no-store"}),page=await r.json() as ArchivePage&{message?:string};if(!r.ok)throw Error(page.message);
   if(id!==generation.current)return;
   setHistory(previous=>[...new Map([...previous,...page.transfers].map(t=>[`${t.txHash.toLowerCase()}:${t.logIndex}`,t])).values()]);setCoverage(previous=>[...previous,...page.coverage]);setCursor(page.nextCursor);setScanned(true);
  }catch(e){if(id===generation.current)setError(controller.signal.aborted?"History check timed out. Retry shortly.":(e as Error).message);}
  finally{clearTimeout(timer);if(id===generation.current)setBusy(false);}
 },[range]);
 // A range/address change cancels the previous request and discards its response.
 useEffect(()=>{if(selected)void load(selected);else{requestRef.current?.abort();generation.current++;setBusy(false);}},[selected,load]);
 const relatedLive=useMemo(()=>live.filter(t=>(t.from.toLowerCase()===selected||t.to.toLowerCase()===selected)&&t.timestamp!==undefined&&reference!==null&&t.timestamp>reference-600000&&t.timestamp<=reference),[live,selected,reference]);
 const merged=useMemo(()=>[...new Map([...history,...relatedLive].filter(t=>t.timestamp!==undefined&&t.timestamp>=bounds.current.since).map(t=>[`${t.txHash.toLowerCase()}:${t.logIndex}`,t])).values()].sort((a,b)=>b.timestamp!-a.timestamp!||Number(BigInt(b.blockNumber)-BigInt(a.blockNumber))||b.logIndex-a.logIndex),[history,relatedLive]);
 const totals=useMemo(()=>activityTotals(merged,selected),[merged,selected]);
 const watch=watches.watches.find(w=>w.address===selected&&w.enabled),threshold=watch?.largeOutflow?parseUsdc(watch.largeOutflow):null;
 const alerts=threshold?history.filter(t=>t.from.toLowerCase()===selected&&t.to.toLowerCase()!==selected&&(parseUsdc(t.value)??0n)>=threshold&&!dismissed.includes(`${watch!.id}:${t.txHash}:${t.logIndex}`)):[];
 function dismiss(){const next=[...new Set([...dismissed,...alerts.map(t=>`${watch!.id}:${t.txHash}:${t.logIndex}`)])].slice(-2000);setDismissed(next);try{localStorage.setItem(ALERT_KEY,JSON.stringify(next));setStorageError(false);}catch{setStorageError(true);}}
 const start=coverage.length?Math.min(...coverage.map(c=>c.from)):null,end=coverage.length?Math.max(...coverage.map(c=>c.to)):null;
 return <><LiveActivity/><section className="personalPanel"><h1>My Activity</h1><p>Save addresses, follow USDC movements and check receipts. No wallet connection needed.</p>
 <form className="personalForm" onSubmit={e=>{e.preventDefault();const value=input.trim().toLowerCase();if(!/^0x[\da-f]{40}$/.test(value)){setError("Enter a full wallet or contract address.");return;}if(value===selected)void load(value);else setSelected(value);}}><label>Your address<input value={input} onChange={e=>setInput(e.target.value)} placeholder="0x… wallet or contract address" spellCheck={false} maxLength={42} required/></label><button type="submit">View activity</button></form>
 {watches.watches.length>0&&<div className="savedAddressTabs" aria-label="Saved addresses">{watches.watches.map(w=><button key={w.id} aria-pressed={w.address===selected} onClick={()=>{setInput(w.address);setSelected(w.address);}}>{w.label||`${w.address.slice(0,6)}…${w.address.slice(-4)}`}</button>)}</div>}
 </section>
 {selected&&<section className="personalPanel"><div className="personalHeading"><h2>{watches.watches.find(w=>w.address===selected)?.label||"Address activity"}</h2><select value={range} onChange={e=>setRange(Number(e.target.value))} aria-label="History time range"><option value={1}>Last hour</option><option value={24}>Last 24 hours</option><option value={168}>Last 7 days</option></select></div>
 <a className="personalAddress" href={`${ARC.explorer}/address/${selected}`} target="_blank" rel="noopener noreferrer">{selected} ↗</a>
 <p>{busy?"Loading verified observations…":scanned?"Recorded observations + current live window":"Current live window"} · {healthy?"Live data fresh":"Live data may be incomplete or stale"}</p>
 <dl className="personalTotals"><div><dt>Received USDC</dt><dd>{formatUnits(totals.received,6)}</dd></div><div><dt>Sent USDC</dt><dd>{formatUnits(totals.sent,6)}</dd></div><div><dt>Net movement</dt><dd>{formatUnits(totals.net,6)}</dd></div><div><dt>Transfer events</dt><dd>{merged.length}</dd></div></dl>
 <p className="personalScope">Totals cover loaded observations, not your wallet balance or a guaranteed full {range}-hour history. Recording began with this release. History is retained for seven days.</p>
 {start!==null&&end!==null?<details><summary>Recorded coverage · {coverage.length} interval(s)</summary><p>{new Date(start).toLocaleString()} — {new Date(end).toLocaleString()}</p><ul>{coverage.slice(0,36).map((c,i)=><li key={i}>{new Date(c.from).toLocaleString()} — {new Date(c.to).toLocaleString()}</li>)}</ul><p>Gaps are unobserved time, not proof that no transfers occurred.</p></details>:scanned&&<p>No archived observations available for this range yet.</p>}
 {error&&<p role="alert">{error}</p>}<div className="personalActions"><button disabled={busy} onClick={()=>void load(selected)}>Refresh history</button>{cursor&&<button disabled={busy} onClick={()=>void load(selected,true,cursor??undefined)}>Load older observations</button>}<Link href="/check">Check a payment →</Link><Link href="/payments">Send USDC →</Link></div>
 <details><summary>Activity summary</summary><p>In the loaded observations, this address received {formatUnits(totals.received,6)} USDC and sent {formatUnits(totals.sent,6)} USDC across {merged.length} transfer events. {totals.peers.length} counterparties were observed. The records do not establish who owns these addresses or why funds moved.</p></details>
 <h3>Top counterparties</h3>{totals.peers.length?totals.peers.slice(0,5).map(([peer,t])=><div className="personalCounterparty" key={peer}><a href={`${ARC.explorer}/address/${peer}`} target="_blank" rel="noopener noreferrer">{peer}</a><span>Sent {formatUnits(t.sent,6)} · received {formatUnits(t.received,6)} USDC · {t.count} events</span></div>):<p>No counterparties in loaded observations.</p>}
 <details open><summary>Transfer evidence · {merged.length}</summary><div className="personalTransfers">{merged.slice(0,100).map(t=><article key={`${t.txHash}:${t.logIndex}`}><strong>{t.from.toLowerCase()===selected&&t.to.toLowerCase()===selected?"SELF":t.to.toLowerCase()===selected?"RECEIVED":"SENT"} · {t.value} USDC</strong><time>{new Date(t.timestamp!).toLocaleString()}</time><span>{t.from} → {t.to}</span><a href={`/check?hash=${t.txHash}`}>Check receipt · log {t.logIndex} →</a></article>)}</div>{merged.length>100&&<p>Showing the latest 100 of {merged.length} loaded events.</p>}{!merged.length&&<p>No matching transfers in the loaded observations. Check coverage before drawing conclusions.</p>}</details>
 {alerts.length>0&&<section className="historicalAlerts" aria-label="Historical large outflows"><h3>Recorded large outflows · {alerts.length}</h3><p>Matches your current ≥ {watch?.largeOutflow} USDC rule in loaded history, including recorded movements while this page was closed. These are retrospective matches; rules may have changed.</p>{alerts.slice(0,20).map(t=><p key={`${t.txHash}:${t.logIndex}`}><a href={`/check?hash=${t.txHash}`}>{t.value} USDC · {new Date(t.timestamp!).toLocaleString()} · check receipt ↗</a></p>)}<button onClick={dismiss}>Dismiss these matches</button></section>}
 {storageError&&<p role="alert">Browser storage is unavailable. Saved alert acknowledgements will not persist.</p>}
 </section>}
 <Watchlist transfers={live} reference={reference} healthy={healthy} selected={selected||null} onInspect={a=>{setInput(a);setSelected(a);}} initialOpen onState={onState}/>
 </>;
}
