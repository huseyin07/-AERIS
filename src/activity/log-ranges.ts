/** Respect RPC result-size limits without dropping or overlapping block ranges. */
export async function boundedLogs<T>(query:(from:bigint,to:bigint)=>Promise<T[]>,from:bigint,to:bigint):Promise<T[]>{
  try{return await query(from,to);}
  catch(error){
    if((error as Error).name!=="LimitExceededRpcError"||to-from<64n)throw error;
    const middle=(from+to)/2n;
    const left=await boundedLogs(query,from,middle);
    const right=await boundedLogs(query,middle+1n,to);
    return [...left,...right];
  }
}
