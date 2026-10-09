import {decodeEventLog,erc20Abi,formatUnits} from "viem";
import {ARC} from "../data/arc";
export function usdcReceiptTransfers(logs:readonly {address:string;data:`0x${string}`;topics:readonly `0x${string}`[];logIndex:number|null}[]){
  return logs.flatMap(log=>{
    if(log.address.toLowerCase()!==ARC.usdc.toLowerCase())return [];
    try{const event=decodeEventLog({abi:erc20Abi,eventName:"Transfer",data:log.data,topics:[...log.topics] as [`0x${string}`,...`0x${string}`[]]});
      return [{from:event.args.from.toLowerCase(),to:event.args.to.toLowerCase(),amountUsdc:formatUnits(event.args.value,6),logIndex:log.logIndex}];
    }catch{return [];}
  });
}
