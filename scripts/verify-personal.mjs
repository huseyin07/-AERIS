import {readFile} from 'node:fs/promises';
const base=process.argv[2];
if(!base)throw Error('Supply the exact deployment URL');
const call=async(path,options)=>fetch(new URL(path,base),{signal:AbortSignal.timeout(60000),...options});
for(const path of ['/activity','/check']){const r=await call(path);if(!r.ok)throw Error(`${path}: ${r.status}`);console.log(`PASS ${path} reachable`);}
const home=await (await call('/')).text();if(home.includes('id="agent-wallet"'))throw Error('Operator wallet remains on dashboard');console.log('PASS public dashboard has no operator wallet card');
for(const path of ['/api/receipt?hash=invalid','/api/activity/history?address=invalid']){const r=await call(path);if(r.status!==400)throw Error('Invalid input accepted');}console.log('PASS malformed receipt/history inputs rejected');
const unauthorized=await call('/api/activity/archive');if(unauthorized.status!==401)throw Error('Archive collector lacks authentication');console.log('PASS archive collector requires authentication');
if(process.argv[3]){const {value}=JSON.parse(await readFile(process.argv[3],'utf8'));const r=await call('/api/activity/archive',{headers:{authorization:`Bearer ${value}`}});if(!r.ok)throw Error(`Archive capture failed: ${r.status}`);const archived=await r.json();console.log(`PASS fresh Arc observation archived · ${archived.transfers} events`);}
const activity=await (await call('/api/activity')).json();if(activity.chainId!==5042||!activity.transfers?.length)throw Error('No usable live transfer available');
const t=activity.transfers.find(t=>t.blockNumber!==activity.latestBlock);if(!t)throw Error('No older transfer for receipt check');
const receipt=await call(`/api/receipt?hash=${t.txHash}`),evidence=await receipt.json();if(!receipt.ok||!['confirmed','confirming'].includes(evidence.status)||!evidence.transfers.some(e=>e.logIndex===t.logIndex&&e.to===t.to.toLowerCase()&&e.amountUsdc===t.value))throw Error('Receipt does not match observed transfer');console.log('PASS real Arc receipt matches exact USDC log');
const q=new URLSearchParams({address:t.from,since:String(Date.now()-86400000),until:String(Date.now())});const r=await call(`/api/activity/history?${q}`),history=await r.json();if(!r.ok||!Array.isArray(history.coverage)||!Array.isArray(history.transfers))throw Error('Persistent history unavailable');if(process.argv[3]&&!history.coverage.length)throw Error('Captured archive not readable');console.log(`PASS persistent history readable · ${history.coverage.length} coverage intervals · ${history.transfers.length} matching events`);
