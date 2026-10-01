import "server-only";
import {createPublicClient,http,parseUnits,type Hex} from "viem";
import {ARC,arcChain} from "@/data/arc";
import {circleWalletClient} from "./client";
import {getCircleConfig} from "./config";

export type ExecutionRequest={to:`0x${string}`;amountUsdc:number;idempotencyKey:string;memo:string};
export type ExecutionResult={txHash:Hex;blockNumber:string;status:"confirmed";explorerUrl:string};

export async function executeArcUsdc(request:ExecutionRequest):Promise<ExecutionResult>{
  if(!Number.isFinite(request.amountUsdc)||request.amountUsdc<=0) throw new Error("Invalid USDC amount.");
  if(!/^0x[\da-fA-F]{40}$/.test(request.to)) throw new Error("Invalid destination.");
  const cfg=getCircleConfig(); const rpc=createPublicClient({chain:arcChain,transport:http(ARC.rpcUrl)});
  const chainId=await rpc.getChainId(); if(chainId!==ARC.chainId) throw new Error(`Arc chain mismatch: ${chainId}`);
  const nonce=await rpc.getTransactionCount({address:cfg.walletAddress,pending:true});
  const value=parseUnits(request.amountUsdc.toFixed(6),18);
  const gas=await rpc.estimateGas({account:cfg.walletAddress,to:request.to,value});
  const fees=await rpc.estimateFeesPerGas();
  if(fees.maxFeePerGas==null||fees.maxPriorityFeePerGas==null) throw new Error("Arc fee estimate unavailable.");
  const transaction=JSON.stringify({type:"eip1559",chainId:ARC.chainId,nonce,to:request.to,value:value.toString(),gas:gas.toString(),maxFeePerGas:fees.maxFeePerGas.toString(),maxPriorityFeePerGas:fees.maxPriorityFeePerGas.toString()});
  const signed=await circleWalletClient().signTransaction({walletId:cfg.walletId,transaction,memo:request.memo});
  const raw=signed.data?.signedTransaction as Hex|undefined; if(!raw?.startsWith("0x")) throw new Error("Circle did not return a signed EVM transaction.");
  const txHash=await rpc.sendRawTransaction({serializedTransaction:raw});
  const receipt=await rpc.waitForTransactionReceipt({hash:txHash,confirmations:1,timeout:60_000});
  if(receipt.status!=="success") throw new Error("Arc transaction failed onchain.");
  return {txHash,blockNumber:receipt.blockNumber.toString(),status:"confirmed",explorerUrl:`${ARC.explorer}/tx/${txHash}`};
}
