import {NextRequest,NextResponse} from "next/server";
import {createPublicClient,http,type Hex} from "viem";
import {ARC,arcChain} from "@/data/arc";
import {usdcReceiptTransfers} from "@/activity/receipt";
export const dynamic="force-dynamic";
export const runtime="nodejs";
const pending=new Map<string,Promise<unknown>>();
export async function GET(request:NextRequest){
  const hash=(request.nextUrl.searchParams.get("hash")??"").toLowerCase();
  if(!/^0x[\da-f]{64}$/.test(hash))return NextResponse.json({message:"Enter a full transaction hash."},{status:400});
  if(pending.size>=12&&!pending.has(hash))return NextResponse.json({message:"Receipt checks are busy. Retry shortly."},{status:503});
  if(!pending.has(hash))pending.set(hash,(async()=>{
    const rpc=createPublicClient({chain:arcChain,transport:http(ARC.rpcUrl,{timeout:8000,retryCount:0,fetchOptions:{cache:"no-store"}})});
    const [chain,head]=await Promise.all([rpc.getChainId(),rpc.getBlock()]);
    const age=Date.now()-Number(head.timestamp)*1000;
    if(chain!==5042||head.number===null||age>120000||age< -30000)throw Error();
    let tx;
    try{tx=await rpc.getTransaction({hash:hash as Hex});}catch(e){if((e as Error).name==="TransactionNotFoundError")return {status:"unknown",message:"This hash was not found on Arc Mainnet. Check the network or retry; no failure has been inferred."};throw e;}
    let receipt;
    try{receipt=await rpc.getTransactionReceipt({hash:hash as Hex});}catch(e){if((e as Error).name==="TransactionReceiptNotFoundError")return {status:"pending",message:"Arc knows this transaction, but a mined receipt is not yet available."};throw e;}
    const block=await rpc.getBlock({blockNumber:receipt.blockNumber});
    if(receipt.blockHash!==block.hash||receipt.transactionHash.toLowerCase()!==hash||tx.blockHash!==receipt.blockHash)throw Error();
    const transfers=receipt.status==="success"?usdcReceiptTransfers(receipt.logs):[];
    const status=head.number<receipt.blockNumber+1n?"confirming":receipt.status==="reverted"?"failed":transfers.length?"confirmed":"no-usdc";
    return {status,chainId:5042,hash,blockNumber:receipt.blockNumber.toString(),confirmations:(head.number-receipt.blockNumber+1n).toString(),checkedAt:new Date().toISOString(),explorerUrl:`${ARC.explorer}/tx/${hash}`,transfers,
      message:status==="confirming"?"Included in the canonical block; waiting for another block.":status==="failed"?"The transaction reverted. No USDC transfer completed; a network fee may have been charged.":status==="no-usdc"?"The transaction succeeded, but contains no native USDC Transfer events.":"USDC transfer events match the successful canonical Arc receipt. This confirms movement, not the purpose of the payment."};
  })().finally(()=>pending.delete(hash)));
  try{return NextResponse.json(await pending.get(hash),{headers:{"Cache-Control":"no-store"}});}
  catch{return NextResponse.json({message:"Arc receipt verification is unavailable. Retry shortly."},{status:503});}
}
