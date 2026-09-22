import {defineChain, getAddress, isAddress} from "viem";

const DEFAULT_MAINNET_RPC = "https://rpc.mainnet.arc.network";
const DEFAULT_MAINNET_EXPLORER = "https://arcscan.app";
const NATIVE_USDC = "0x3600000000000000000000000000000000000000";

function validatedUrl(name: string, value: string) {
  const url = new URL(value);
  if (url.protocol !== "https:") throw new Error(`${name} must be an HTTPS URL`);
  return url.toString().replace(/\/$/, "");
}

function validatedAddress(name: string, value: string): `0x${string}` {
  if (!isAddress(value)) throw new Error(`${name} is not a valid address`);
  return getAddress(value);
}

/** Arc Mainnet only. There is deliberately no testnet fallback. */
export const ARC = {
  mode: "mainnet" as const,
  name: "Arc Mainnet",
  chainId: 5042,
  rpcUrl: validatedUrl("ARC_MAINNET_RPC_URL", process.env.ARC_MAINNET_RPC_URL ?? DEFAULT_MAINNET_RPC),
  explorer: validatedUrl("ARC_MAINNET_EXPLORER", process.env.ARC_MAINNET_EXPLORER ?? DEFAULT_MAINNET_EXPLORER),
  usdc: validatedAddress("ARC_MAINNET_USDC", process.env.ARC_MAINNET_USDC ?? NATIVE_USDC),
  decimals: 6,
  docs: "https://docs.arc.network",
};

export const arcChain = defineChain({
  id: ARC.chainId,
  name: ARC.name,
  nativeCurrency: {name: "USDC", symbol: "USDC", decimals: 18},
  rpcUrls: {default: {http: [ARC.rpcUrl]}},
  blockExplorers: {default: {name: "Arcscan", url: ARC.explorer}},
});
