import {defineChain} from "viem";

export const ARC={
  mode:"mainnet" as const,
  name:"Arc Mainnet",
  chainId:5042,
  rpcUrl:process.env.ARC_MAINNET_RPC_URL??"https://rpc.mainnet.arc.io",
  wsUrl:process.env.ARC_MAINNET_WS_URL??"",
  explorer:process.env.ARC_MAINNET_EXPLORER??"https://explorer.arc.io",
  usdc:(process.env.ARC_MAINNET_USDC??"0x3600000000000000000000000000000000000000") as `0x${string}`,
  decimals:6,
  docs:"https://docs.arc.io",
  note:"Arc public mainnet. Chain ID 5042; native USDC exposes an ERC-20 interface at the canonical 0x3600…0000 predeploy."
};

export const arcChain=defineChain({
  id:ARC.chainId,
  name:ARC.name,
  nativeCurrency:{name:"USDC",symbol:"USDC",decimals:18},
  rpcUrls:{default:{http:[ARC.rpcUrl]}},
  blockExplorers:{default:{name:"Arc Explorer",url:ARC.explorer}}
});
