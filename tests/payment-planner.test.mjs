import {test} from 'node:test';
import assert from 'node:assert/strict';
import {planInvoices} from '../src/payments/planner.ts';
const now=Date.parse('2026-10-08T19:00:00Z');
const payer='0x'+'1'.repeat(40), recipient='0x'+'2'.repeat(40);
const policy={version:1,walletId:'00000000-0000-0000-0000-000000000001',payer,allowedRecipients:[recipient],maxPaymentUsdc:'0.1',dailyBudgetUsdc:'0.5',maxGasUsdc:'0.1',reserveUsdc:'0.05',autoPay:false,approvalAboveUsdc:'0.1',emergencyStop:false};
const invoice=(reference,dueAt='2026-10-08T18:00:00Z')=>({version:1,chainId:5042,reference,recipient,amountUsdc:'0.1',dueAt,purpose:'Invoice planning test'});
test('earliest due invoice consumes liquidity with maximum fees; later invoice is held',()=>{
 const p=planInvoices([invoice('LATE'),invoice('EARLY','2026-10-08T17:00:00Z')],policy,'0.3',new Set(),now);
 assert.deepEqual(p.rows.map(r=>[r.reference,r.action]),[['EARLY','approval'],['LATE','hold']]);
 assert.equal(p.remainingUsdc,'0.1'); assert.equal(p.dueUsdc,'0.2');
});
test('future obligations are forecast but never allocated; verified settlements are excluded',()=>{
 const p=planInvoices([invoice('PAID'),invoice('NEXT','2026-10-10T18:00:00Z')],policy,'0.3',new Set([recipient+':PAID']),now);
 assert.equal(p.dueUsdc,'0'); assert.equal(p.upcomingUsdc,'0.1'); assert.equal(p.allocatedUsdc,'0');
 assert.deepEqual(p.rows.map(r=>r.action),['settled','hold']);
});
test('daily budget and emergency stop cannot be bypassed by planning several invoices',()=>{
 const p=planInvoices([invoice('A'),invoice('B')],{...policy,dailyBudgetUsdc:'0.3',maxPaymentUsdc:'0.1'},'10',new Set(),now);
 assert.deepEqual(p.rows.map(r=>r.action),['approval','hold']);
 assert.equal(planInvoices([invoice('A')],{...policy,emergencyStop:true},'10',new Set(),now).rows[0].action,'hold');
});
test('duplicate invoice keys and invalid amounts fail closed',()=>{
 assert.throws(()=>planInvoices([invoice('A'),invoice('A')],policy,'10',new Set(),now));
 assert.throws(()=>planInvoices([invoice('A')],policy,'NaN',new Set(),now));
});
