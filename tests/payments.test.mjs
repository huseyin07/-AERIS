import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp, rm, writeFile, readFile} from "node:fs/promises";
import {spawn} from "node:child_process";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {encodeEventTopics, encodeAbiParameters, erc20Abi, serializeTransaction} from "viem";
import {privateKeyToAccount} from "viem/accounts";
import {decidePayment, invoiceFingerprint, paymentData, PAYMENT_TOKEN, units, validateInvoice, validatePolicy, verifyPaymentEvidence} from "../src/payments/core.ts";
import {existingInvoice, readJournal, reservation, reservedToday, saveJournal, withJournalLock} from "../src/payments/journal.ts";
import {validateSignedPayment, validateUnsignedInvoice} from "../src/payments/circle-signer.ts";

const payer = '0x1111111111111111111111111111111111111111';
const recipient = '0x2222222222222222222222222222222222222222';
const hash = '0x' + 'ab'.repeat(32), blockHash = '0x' + 'cd'.repeat(32);
const invoice = validateInvoice({version:1, chainId:5042, reference:'INV-001', recipient, amountUsdc:'0.1', dueAt:'2026-10-08T00:00:00Z', purpose:'Verified service invoice'});
const policy = validatePolicy({version:1, walletId:'be9740e5-b27d-5226-8517-0bdafd7125fd',payer,allowedRecipients:[recipient], maxPaymentUsdc:'1',dailyBudgetUsdc:'3',maxGasUsdc:'0.1',reserveUsdc:'0.05',autoPay:false,approvalAboveUsdc:'0.1',emergencyStop:false});
const now = Date.parse('2026-10-08T12:00:00Z');
test('exact USDC amounts, valid invoice and operator policy reject invalid inputs', () => {
  assert.equal(units('0.000001'),1n);
  for (const value of ['1e3','-1','0','0.0000001','1.001garbage']) assert.throws(()=>units(value));
  assert.throws(()=>validateInvoice({...invoice,recipient:'0x'+'0'.repeat(40)}));
  assert.throws(()=>validateInvoice({...invoice,chainId:1}));
  assert.throws(()=>validateInvoice({...invoice,reference:'shell; injection'}));
  assert.throws(()=>validatePolicy({...policy,allowedRecipients:[]}));
});
test('agent holds future invoices, disallowed recipients, stopped policy and insufficient liquidity', () => {
  const decide = (i=invoice,p=policy,b=units('10'))=>decidePayment(i,p,b,0n,units('0.01'),now);
  assert.equal(decide().action,'pay'); assert.equal(decide().requiresApproval,true);
  assert.equal(decide({...invoice,dueAt:'2026-10-09T00:00:00Z'}).action,'hold');
  assert.equal(decide(invoice,{...policy,allowedRecipients:[]}).action,'hold');
  assert.equal(decide(invoice,{...policy,emergencyStop:true}).action,'hold');
  assert.equal(decide(invoice,policy,units('0.15')).action,'hold');
  assert.equal(decide({...invoice,recipient:payer}).action,'hold');
});
test('payment limits include exact fee reservations and human approval threshold', () => {
  assert.equal(decidePayment(invoice,{...policy,autoPay:true},units('2'),0n,units('0.01'),now).requiresApproval,false);
  assert.equal(decidePayment({...invoice,amountUsdc:'0.100001'},{...policy,autoPay:true},units('2'),0n,units('0.01'),now).requiresApproval,true);
  assert.equal(decidePayment(invoice,policy,units('10'),units('2.9'),units('0.01'),now).action,'hold');
  assert.equal(decidePayment(invoice,policy,units('10'),0n,units('0.100001'),now).action,'hold');
  assert.equal(reservation(invoice,1n),100001n);
});
const tx = {hash,from:payer,to:PAYMENT_TOKEN,input:paymentData(invoice),value:0n,chainId:5042};
const receipt = {transactionHash:hash,from:payer,to:PAYMENT_TOKEN,status:'success',blockNumber:10n,blockHash,gasUsed:25000n,effectiveGasPrice:1n,
  logs:[{address:PAYMENT_TOKEN,logIndex:5,topics:encodeEventTopics({abi:erc20Abi,eventName:'Transfer',args:{from:payer,to:recipient}}),data:encodeAbiParameters([{type:'uint256'}],[units('0.1')])}]};
test('only exact, canonical confirmed settlement from the Circle payer is accepted', () => {
  assert.equal(verifyPaymentEvidence(invoice,payer,receipt,tx,11n,blockHash).logIndex,5);
  for (const patch of [{status:'reverted'},{from:recipient},{to:recipient},{blockHash:hash},{logs:[]},{logs:[...receipt.logs,...receipt.logs]}]) assert.throws(()=>verifyPaymentEvidence(invoice,payer,{...receipt,...patch},tx,11n,blockHash));
  assert.throws(()=>verifyPaymentEvidence({...invoice,amountUsdc:'0.2'},payer,receipt,tx,11n,blockHash));
  assert.throws(()=>verifyPaymentEvidence(invoice,payer,receipt,{...tx,input:'0x'},11n,blockHash));
  assert.throws(()=>verifyPaymentEvidence(invoice,payer,receipt,tx,10n,blockHash));
});
test('durable journal blocks concurrent processes, remembers invoice identity and reserves unresolved payments across days', async()=>{
  const dir = await mkdtemp(join(tmpdir(),'aeris-payments-'));
  try {
    await withJournalLock(dir, async()=>{
      await assert.rejects(withJournalLock(dir,async()=>{}),/Another payment runner/);
      const journal = await readJournal(dir);
      const record = {invoice,fingerprint:invoiceFingerprint(invoice),payer,createdAt:'2026-10-07T12:00:00Z',state:'prepared',reservedUsdcUnits:'110000',unsigned:'0x02ab'};
      journal.records.push(record); await saveJournal(dir,journal);
      const restored = await readJournal(dir);
      assert.equal(existingInvoice(restored,invoice).fingerprint,record.fingerprint);
      assert.throws(()=>existingInvoice(restored,{...invoice,amountUsdc:'0.2'}),/different details/);
      assert.equal(reservedToday(restored,now),110000n);
      restored.records[0].state='confirmed'; assert.equal(reservedToday(restored,now),0n);
    });
    await withJournalLock(dir,async()=>assert.equal((await readJournal(dir)).records.length,1));
  } finally {await rm(dir,{recursive:true,force:true});}
});
test('signed transaction must match payer, chain, amount, destination, fees and nonce before broadcast', async()=>{
  // A synthetic test-only key, never used onchain or as a configured Circle wallet.
  const account = privateKeyToAccount('0x'+'11'.repeat(32));
  const prepared = {chainId:5042,type:'eip1559',nonce:0,gas:30000n,maxFeePerGas:2n,maxPriorityFeePerGas:1n,to:PAYMENT_TOKEN,value:0n,data:paymentData(invoice)};
  const unsigned=serializeTransaction(prepared), signed=await account.signTransaction(prepared);
  validateUnsignedInvoice(unsigned,invoice);
  assert.throws(()=>validateUnsignedInvoice(serializeTransaction({...prepared,to:recipient}),invoice));
  await validateSignedPayment(signed,unsigned,account.address);
  await assert.rejects(validateSignedPayment(signed,unsigned,payer));
  for (const patch of [{nonce:1},{chainId:1},{to:recipient},{gas:40000n},{data:paymentData({...invoice,amountUsdc:'0.2'})}]) await assert.rejects(validateSignedPayment(signed,serializeTransaction({...prepared,...patch}),account.address));
});
test('runner preview never signs; crash after chain acceptance recovers the same signed payment without paying twice', async()=>{
  const dir=await mkdtemp(join(tmpdir(),'aeris-runner-'));
  const account=privateKeyToAccount('0x'+'11'.repeat(32));
  const provider=join(dir,'synthetic-provider.json'), invoicePath=join(dir,'invoice.json');
  const input={...invoice,dueAt:'2026-01-01T00:00:00.000Z'};
  await writeFile(join(dir,'policy.json'),JSON.stringify({...policy,payer:account.address.toLowerCase(),autoPay:true}));
  await writeFile(invoicePath,JSON.stringify(input));
  async function run(extra=[],crash=false){return await new Promise(resolveRun=>{
    const child=spawn(process.execPath,['--import','tsx','--import','./tests/fixtures/payment-provider.mjs','scripts/circle-pay.ts','pay',invoicePath,...extra],{cwd:process.cwd(),env:{...process.env,AERIS_PAYMENT_DIRECTORY:dir,AERIS_TEST_PROVIDER:provider,AERIS_TEST_CRASH:String(crash),CIRCLE_API_KEY:'LIVE_API_KEY:synthetic-test-only',CIRCLE_ENTITY_SECRET:'11'.repeat(32)},stdio:['ignore','pipe','pipe']});
    let output='';child.stdout.on('data',s=>output+=s);child.stderr.on('data',s=>output+=s);child.on('close',code=>resolveRun({code,output}));
  });}
  try{
    const preview=await run(); assert.equal(preview.code,0,preview.output); assert.match(preview.output,/Preview only/);
    await assert.rejects(readFile(provider));
    const crashed=await run(['--execute'],true); assert.equal(crashed.code,73,crashed.output);
    const before=await readJournal(dir); assert.equal(before.records[0].state,'signed');
    const txHash=before.records[0].txHash;
    await rm(join(dir,'execution.lock')); // The synthetic child has terminated; preserve the journal.
    const recovered=await run(['--execute']); assert.equal(recovered.code,0,recovered.output); assert.match(recovered.output,/SETTLEMENT VERIFIED/);
    const after=await readJournal(dir); assert.equal(after.records[0].state,'confirmed'); assert.equal(after.records[0].txHash,txHash);
    const repeated=await run(['--execute']); assert.equal(repeated.code,0,repeated.output); assert.match(repeated.output,/Already paid/);
    const calls=JSON.parse(await readFile(provider,'utf8')); assert.equal(calls.signs,1); assert.equal(calls.broadcasts,1);
  }finally{await rm(dir,{recursive:true,force:true});}
});
