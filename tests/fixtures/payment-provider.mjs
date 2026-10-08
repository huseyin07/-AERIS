// Synthetic provider for process-crash/retry tests. It never reaches Circle or Arc.
import {readFileSync,writeFileSync} from 'node:fs';
import {generateKeyPairSync} from 'node:crypto';
import {privateKeyToAccount} from 'viem/accounts';
import {encodeAbiParameters,encodeEventTopics,erc20Abi,keccak256,parseTransaction} from 'viem';
const file=process.env.AERIS_TEST_PROVIDER;
const account=privateKeyToAccount('0x'+'11'.repeat(32));
const token='0x3600000000000000000000000000000000000000';
const recipient='0x2222222222222222222222222222222222222222';
const blockHash='0x'+'cd'.repeat(32);
const publicKey=generateKeyPairSync('rsa',{modulusLength:2048}).publicKey.export({format:'pem',type:'spki'});
let state; try{state=JSON.parse(readFileSync(file,'utf8'));}catch{state={signs:0,broadcasts:0};}
const save=()=>writeFileSync(file,JSON.stringify(state),{mode:0o600});
globalThis.fetch=async(url,options={})=>{
  const address=typeof url==='string'?url:url.url;
  const requestBody=options.body ?? (url instanceof Request ? await url.text() : undefined);
  if(address.startsWith('https://api.circle.com/v1/w3s/')){
    const path=address.slice('https://api.circle.com/v1/w3s/'.length);
    if(path.startsWith('wallets/'))return Response.json({data:{wallet:{id:path.slice(8),address:account.address,blockchain:'EVM',custodyType:'DEVELOPER',accountType:'EOA',state:'LIVE'}}});
    if(path==='config/entity/publicKey')return Response.json({data:{publicKey}});
    if(path==='developer/sign/transaction'){
      const body=JSON.parse(requestBody); state.signs++;save();
      const transaction=parseTransaction(body.rawTransaction);
      return Response.json({data:{signedTransaction:await account.signTransaction(transaction)}});
    }
    throw new Error('Unexpected synthetic Circle operation');
  }
  if(address!=='https://rpc.mainnet.arc.io'&&address!=='https://rpc.mainnet.arc.io/')throw new Error('Test attempted external networking');
  const request=JSON.parse(requestBody);
  const {method,params=[]}=request;
  let result;
  if(method==='eth_chainId')result='0x13b2';
  else if(method==='eth_getBlockByNumber')result={number:params[0]==='0x63'?'0x63':'0x64',hash:blockHash,parentHash:blockHash,timestamp:'0x'+Math.floor(Date.now()/1000).toString(16),baseFeePerGas:'0x1',gasLimit:'0x1c9c380',gasUsed:'0x0',transactions:[]};
  else if(method==='eth_call')result='0x'+(10000000n).toString(16).padStart(64,'0');
  else if(method==='eth_getBalance')result='0x'+(10n*10n**18n).toString(16);
  else if(method==='eth_getTransactionCount')result=state.raw?'0x1':'0x0';
  else if(method==='eth_maxPriorityFeePerGas')result='0x1';
  else if(method==='eth_gasPrice')result='0x2';
  else if(method==='eth_estimateGas')result='0x7530';
  else if(method==='eth_sendRawTransaction'){
    state.raw=params[0];state.broadcasts++;save();
    // Simulate process loss after chain acceptance, before the sender receives a response.
    if(process.env.AERIS_TEST_CRASH==='true')process.exit(73);
    result=keccak256(state.raw);
  }else if(method==='eth_getTransactionReceipt'){
    result=state.raw?{transactionHash:keccak256(state.raw),transactionIndex:'0x0',blockNumber:'0x63',blockHash,from:account.address,to:token,status:'0x1',type:'0x2',gasUsed:'0x7530',cumulativeGasUsed:'0x7530',effectiveGasPrice:'0x2',logs:[{address:token,blockNumber:'0x63',blockHash,transactionHash:keccak256(state.raw),transactionIndex:'0x0',logIndex:'0x5',removed:false,topics:encodeEventTopics({abi:erc20Abi,eventName:'Transfer',args:{from:account.address,to:recipient}}),data:encodeAbiParameters([{type:'uint256'}],[100000n])}]}:null;
  }else if(method==='eth_getTransactionByHash'){
    const tx=parseTransaction(state.raw);
    result={hash:keccak256(state.raw),blockHash,blockNumber:'0x63',transactionIndex:'0x0',chainId:'0x13b2',nonce:'0x0',from:account.address,to:token,input:tx.data,value:'0x0',gas:'0x7530',gasPrice:'0x2',maxFeePerGas:'0x2',maxPriorityFeePerGas:'0x1',type:'0x2',r:tx.r,s:tx.s,v:'0x1',yParity:'0x1',accessList:[]};
  }else throw new Error('Unexpected synthetic RPC operation: '+method);
  return Response.json({jsonrpc:'2.0',id:request.id,result});
};
