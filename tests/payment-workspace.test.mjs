import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULT_SETTINGS, importInvoices, validateSettings} from '../src/payments/workspace.ts';
const invoice = {version:1,chainId:5042,reference:'REAL-001',recipient:'0x'+'2'.repeat(40),amountUsdc:'0.1',dueAt:'2026-10-08T18:00:00.000Z',purpose:'Portable invoice test'};
test('invoice backup retains payment hash but cannot import a paid or verified status',()=>{
 const hash='0x'+'a'.repeat(64);
 const value={version:1,invoices:[{invoice,txHash:hash,status:'verified',evidence:{status:'verified'}}]};
 assert.deepEqual(importInvoices(value,[]),[{invoice,txHash:hash}]);
 assert.deepEqual(importInvoices(invoice,[]),[{invoice,txHash:''}]);
});
test('imports reject duplicates, wrong network, malformed hashes and self payments atomically',()=>{
 const existing=[{invoice,txHash:''}];
 assert.throws(()=>importInvoices(invoice,existing),/already saved/);
 assert.throws(()=>importInvoices({version:1,invoices:[invoice,invoice]},[]),/already saved/);
 assert.throws(()=>importInvoices({...invoice,chainId:1},[]));
 assert.throws(()=>importInvoices({invoice,txHash:'0xfake'},[]));
 assert.throws(()=>importInvoices(invoice,[],invoice.recipient),/itself/);
 assert.equal(existing.length,1);
});
test('operator settings preserve explicit pause and automation, reject unsafe limits, and strip extras',()=>{
 const value={...DEFAULT_SETTINGS,automatic:true,emergencyStop:true,apiKey:'must not persist'};
 assert.deepEqual(validateSettings(value),{...DEFAULT_SETTINGS,automatic:true,emergencyStop:true});
 assert.throws(()=>validateSettings({...value,dailyBudget:'0.01'}));
 assert.throws(()=>validateSettings({...value,gasLimit:'NaN'}));
 assert.throws(()=>validateSettings({...value,automatic:'true'}));
});
