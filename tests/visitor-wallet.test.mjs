import test from 'node:test';
import assert from 'node:assert/strict';
import {decodeFunctionData, erc20Abi} from 'viem';
import {submitTransfer, switchToArc, transferInvoice, validateQuote} from '../src/payments/visitor-wallet.ts';
import {PAYMENT_TOKEN, isConfirmedFailedTransfer, paymentData} from '../src/payments/core.ts';
const payer='0x'+'1'.repeat(40), recipient='0x'+'2'.repeat(40), hash='0x'+'ab'.repeat(32);
const invoice=transferInvoice(recipient,'0.1','Technical provider test');
const quote=()=>({chainId:5042,payer,recipient,amountUsdc:'0.1',balanceUsdc:'0.3',maximumFeeUsdc:'0.001',totalUsdc:'0.101',gas:'50000',maxFeePerGas:'20000000000',maxPriorityFeePerGas:'1000000000',checkedAt:Date.now(),blockNumber:'1'});
function provider(account=payer,chain='0x13b2',result=hash){const calls=[];return {calls,async request(args){calls.push(args);if(args.method==='eth_accounts')return [account];if(args.method==='eth_chainId')return chain;if(args.method==='eth_sendTransaction')return result;throw Error('Unexpected method');}};}
test('personal transfer signs only exact USDC calldata, without token approval or server keys',async()=>{
 const wallet=provider();assert.equal(await submitTransfer(wallet,payer,invoice,quote()),hash);
 const request=wallet.calls.find(v=>v.method==='eth_sendTransaction').params[0];
 assert.equal(request.from,payer);assert.equal(request.to,PAYMENT_TOKEN);assert.equal(request.chainId,'0x13b2');assert.equal(request.value,'0x0');
 const decoded=decodeFunctionData({abi:erc20Abi,data:request.data});assert.equal(decoded.functionName,'transfer');assert.deepEqual(decoded.args,[recipient,100000n]);
 assert.equal(wallet.calls.filter(v=>v.method==='eth_sendTransaction').length,1);
});
test('stale, mismatched, underfunded and inconsistent fee reviews cannot reach wallet submission',async()=>{
 for(const patch of [{checkedAt:Date.now()-61000},{payer:recipient},{chainId:1},{amountUsdc:'0.2'},{recipient:payer},{balanceUsdc:'0.1'},{maximumFeeUsdc:'0.000001'},{totalUsdc:'0.1'},{gas:'-1'}]){
  const wallet=provider();await assert.rejects(submitTransfer(wallet,payer,invoice,{...quote(),...patch}));assert.equal(wallet.calls.length,0);
 }
 assert.throws(()=>validateQuote(quote(),transferInvoice(payer,'0.1','self'),payer));
});
test('account/network changes and missing hashes fail without repeating a submission',async()=>{
 for(const wallet of [provider(recipient),provider(payer,'0x1')]){await assert.rejects(submitTransfer(wallet,payer,invoice,quote()));assert.equal(wallet.calls.filter(v=>v.method==='eth_sendTransaction').length,0);}
 const unknown=provider(payer,'0x13b2',undefined);unknown.request=async args=>{unknown.calls.push(args);if(args.method==='eth_accounts')return [payer];if(args.method==='eth_chainId')return '0x13b2';return undefined;};
 await assert.rejects(submitTransfer(unknown,payer,invoice,quote()),/no transaction hash/);assert.equal(unknown.calls.filter(v=>v.method==='eth_sendTransaction').length,1);
 const cancelled=provider();cancelled.request=async args=>{cancelled.calls.push(args);if(args.method==='eth_accounts')return [payer];if(args.method==='eth_chainId')return '0x13b2';throw Object.assign(Error('User rejected'),{code:4001});};
 await assert.rejects(submitTransfer(cancelled,payer,invoice,quote()),/rejected/);assert.equal(cancelled.calls.filter(v=>v.method==='eth_sendTransaction').length,1);
});
test('network setup adds only Arc mainnet, and does not treat user rejection as missing network',async()=>{
 const calls=[];let switched=false;const wallet={async request(args){calls.push(args);if(args.method==='wallet_switchEthereumChain'){if(!switched){switched=true;throw Object.assign(Error('Missing'),{code:4902});}return null;}if(args.method==='wallet_addEthereumChain')return null;if(args.method==='eth_chainId')return '0x13b2';}};
 await switchToArc(wallet);assert.equal(calls[1].params[0].chainId,'0x13b2');assert.equal(calls[1].params[0].nativeCurrency.decimals,18);
 const noAdd=[];await assert.rejects(switchToArc({async request(args){noAdd.push(args);throw Object.assign(Error('Rejected'),{code:4001});}}));assert.equal(noAdd.length,1);
});
test('a failed transfer can be released only with exact confirmed canonical failure evidence',()=>{
 const blockHash='0x'+'cd'.repeat(32);const tx={hash,from:payer,to:PAYMENT_TOKEN,input:paymentData(invoice),value:0n,chainId:5042};const receipt={transactionHash:hash,from:payer,to:PAYMENT_TOKEN,status:'reverted',blockNumber:1n,blockHash,gasUsed:1n,effectiveGasPrice:1n,logs:[]};
 assert.equal(isConfirmedFailedTransfer(invoice,payer,receipt,tx,2n,blockHash),true);
 for(const patched of [{...tx,from:recipient},{...tx,chainId:1},{...tx,input:'0x'}])assert.equal(isConfirmedFailedTransfer(invoice,payer,receipt,patched,2n,blockHash),false);
 assert.equal(isConfirmedFailedTransfer(invoice,payer,receipt,tx,1n,blockHash),false);assert.equal(isConfirmedFailedTransfer(invoice,payer,receipt,tx,2n,hash),false);
});
