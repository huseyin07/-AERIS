import {defineChain, getAddress, isAddress} from "viem";

export const DEFAULT_MAINNET_RPC = "https://rpc.mainnet.arc.network";
export const DEFAULT_MAINNET_EXPLORER = "https://arcscan.app";
export const NATIVE_USDC = "0x3600000000000000000000000000000000000000";

/** Arc Mainnet only. There is deliberately no testnet fallback. */
export const ARC = {
  mode: "mainnet" as const,
  name: "Arc Mainnet",
  chainId: 5042,
  rpcUrl: process.env.ARC_MAINNET_RPC_URL ?? DEFAULT_MAINNET_RPC,
  explorer: process.env.ARC_MAINNET_EXPLORER ?? DEFAULT_MAINNET_EXPLORER,
  usdc: (process.env.ARC_MAINNET_USDC ?? NATIVE_USDC) as `0x${string}`,
  decimals: 6,
  docs: "https://docs.arc.network",
};

export type ArcConfiguration = typeof ARC & {
  rpcUrl: string;
  explorer: string;
  usdc: `0x${string}`;
};

function requireHttpsUrl(name: string, value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} is not a valid URL`);
  }
  if (url.protocol !== "https:") throw new Error(`${name} must be an HTTPS URL`);
  return url.toString().replace(/\/$/, "");
}

/** Validate at request time so a stale Vercel variable produces a categorized API error. */
export function getArcConfiguration(): ArcConfiguration {
  const rpcUrl = requireHttpsUrl("ARC_MAINNET_RPC_URL", ARC.rpcUrl);
  const explorer = requireHttpsUrl("ARC_MAINNET_EXPLORER", ARC.explorer);
  if (!isAddress(ARC.usdc)) throw new Error("ARC_MAINNET_USDC is not a valid address");
  return {...ARC, rpcUrl, explorer, usdc: getAddress(ARC.usdc)};
}

export function safeArcConfigurationContext() {
  let rpcHost = "invalid";
  try {
    rpcHost = new URL(ARC.rpcUrl).hostname;
  } catch {
    // Never log the raw value: an RPC URL may contain a secret key.
  }
  return {
    chainId: ARC.chainId,
    rpcHost,
    rpcSource: process.env.ARC_MAINNET_RPC_URL ? "environment" : "default",
    explorerSource: process.env.ARC_MAINNET_EXPLORER ? "environment" : "default",
    usdcSource: process.env.ARC_MAINNET_USDC ? "environment" : "default",
  };
}

export function createArcChain(config: ArcConfiguration) {
  return defineChain({
    id: config.chainId,
    name: config.name,
    nativeCurrency: {name: "USDC", symbol: "USDC", decimals: 18},
    rpcUrls: {default: {http: [config.rpcUrl]}},
    blockExplorers: {default: {name: "Arcscan", url: config.explorer}},
  });
}

// Used by explorer links in client components. RPC work always uses validated request-time config.
export const arcChain = createArcChain({...ARC, rpcUrl: DEFAULT_MAINNET_RPC, explorer: DEFAULT_MAINNET_EXPLORER, usdc: NATIVE_USDC});
