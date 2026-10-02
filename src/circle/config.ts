export type CircleConfig = {apiKey:string;entitySecret:string;walletId:string;walletAddress:`0x${string}`};
export function getCircleConfig():CircleConfig {
  const apiKey=process.env.CIRCLE_API_KEY; const entitySecret=process.env.CIRCLE_ENTITY_SECRET; const walletId=process.env.CIRCLE_EVM_WALLET_ID; const walletAddress=process.env.CIRCLE_EVM_WALLET_ADDRESS;
  if(!apiKey || !entitySecret || !walletId || !walletAddress) throw new Error("Circle executor is not configured.");
  if(!/^0x[\da-fA-F]{40}$/.test(walletAddress)) throw new Error("CIRCLE_EVM_WALLET_ADDRESS is invalid.");
  return {apiKey,entitySecret,walletId,walletAddress:walletAddress as `0x${string}`};
}
export function circleConfigured(){return Boolean(process.env.CIRCLE_API_KEY&&process.env.CIRCLE_ENTITY_SECRET&&process.env.CIRCLE_EVM_WALLET_ID&&process.env.CIRCLE_EVM_WALLET_ADDRESS);}
