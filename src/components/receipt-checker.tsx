"use client";
import {useState,useEffect,useRef,type FormEvent} from "react";
import {ARC} from "@/data/arc";
import {parseUsdc} from "@/watchlist/engine";
type Receipt={status:string;message:string;hash?:string;blockNumber?:string;confirmations?:string;checkedAt?:string;transfers?:{from:string;to:string;amountUsdc:string;logIndex:number|null}[]};
export function ReceiptChecker(){
 const [hash,setHash]=useState(""),[recipient,setRecipient]=useState(""),[amount,setAmount]=useState(""),[result,setResult]=useState<Receipt|null>(null),[error,setError]=useState(""),[busy,setBusy]=useState(false);
 const controller=useRef<AbortController|null>(null);
 useEffect(()=>{const q=new URLSearchParams(location.search);const h=q.get("hash"),a=q.get("address");if(h&&/^0x[\da-f]{64}$/i.test(h))setHash(h);if(a&&/^0x[\da-f]{40}$/i.test(a))setRecipient(a);return()=>controller.current?.abort();},[]);
 async function submit(e:FormEvent){e.preventDefault();if(busy)return;
  if(!/^0x[\da-f]{64}$/i.test(hash.trim())){setError("Enter the full transaction hash.");return;}
  if(recipient&&!/^0x[\da-f]{40}$/i.test(recipient.trim())){setError("Enter the full recipient address.");return;}
  if(amount&&parseUsdc(amount.trim())===null){setError("Enter a positive amount with up to six decimals.");return;}
  setBusy(true);setError("");setResult(null);const abort=new AbortController();controller.current=abort;const timer=setTimeout(()=>abort.abort(),25000);
  try{const r=await fetch(`/api/receipt?hash=${encodeURIComponent(hash.trim())}`,{signal:abort.signal,cache:"no-store"});const value=await r.json();if(!r.ok)throw Error(value.message);setResult(value);}
  catch(e){if(!abort.signal.aborted)setError((e as Error).message);else setError("The receipt check timed out. Retry shortly.");}
  finally{clearTimeout(timer);setBusy(false);}
 }
 const matching=result?.transfers?.filter(t=>(!recipient||t.to===recipient.trim().toLowerCase())&&(!amount||parseUsdc(t.amountUsdc)===parseUsdc(amount.trim())));
 return <section className="personalPanel" id="check-payment"><h2>Check a payment</h2><p>Paste an Arc transaction hash. No wallet connection required.</p>
  <form onSubmit={submit} className="personalForm"><label>Transaction hash<input disabled={busy} value={hash} onChange={e=>{setHash(e.target.value);setResult(null);}} placeholder="0x… full transaction hash" spellCheck={false} required maxLength={66}/></label>
   <details><summary>Match an expected payment (optional)</summary><label>Recipient<input value={recipient} onChange={e=>setRecipient(e.target.value)} placeholder="0x… full address" maxLength={42} spellCheck={false}/></label><label>Exact USDC amount<input value={amount} onChange={e=>setAmount(e.target.value)} inputMode="decimal" placeholder="100.00"/></label><p>Matches a single transfer event. Several transfers are not combined into one payment.</p></details>
   <button disabled={busy} type="submit">{busy?"Checking Arc…":"Check receipt"}</button>
  </form>{error&&<p role="alert">{error}</p>}
  {result&&<div className="receiptResult" role="status"><strong>{result.status.toUpperCase()}</strong><p>{result.message}</p>{result.blockNumber&&<p>Block {result.blockNumber} · {result.confirmations} confirmation(s)</p>}
   {result.status==="confirmed"&&(recipient||amount)&&<p>{matching?.length?"Expected recipient / amount matched.":"The expected payment does not match any single USDC event in this receipt."}</p>}
   {result.transfers?.map(t=><article key={t.logIndex}><strong>{t.amountUsdc} USDC</strong><p>From <a href={`${ARC.explorer}/address/${t.from}`} target="_blank" rel="noopener noreferrer">{t.from}</a></p><p>To <a href={`${ARC.explorer}/address/${t.to}`} target="_blank" rel="noopener noreferrer">{t.to}</a> · log {t.logIndex}</p></article>)}
   {result.hash&&<a href={`${ARC.explorer}/tx/${result.hash}`} target="_blank" rel="noopener noreferrer">Verify on Arcscan ↗</a>}{result.checkedAt&&<p>Checked {new Date(result.checkedAt).toLocaleString()}</p>}
  </div>}
 </section>;
}
