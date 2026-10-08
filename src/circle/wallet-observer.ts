import "server-only";
import {createPublicClient, erc20Abi, formatUnits, http} from "viem";
import {ARC, arcChain} from "@/data/arc";
import {circleReadConfigured} from "./config";
import {circleWalletClient} from "./client";
import type {AgentWalletStatus} from "./wallet-types";
import {readVerifiedArcBalance} from "./arc-wallet-read";

const base = {network: "Arc Mainnet", chainId: 5042, execution: "disabled"} as const;
let cache: {expiresAt: number; value: AgentWalletStatus} | null = null;
let pending: Promise<AgentWalletStatus> | null = null;

async function observe(): Promise<AgentWalletStatus> {
  if (!circleReadConfigured()) return {...base, status: "not-configured", message: "Agent wallet setup is pending. Network intelligence remains available."};
  try {
    const wallet = await circleWalletClient();
    const rpc = createPublicClient({chain: arcChain, transport: http(ARC.rpcUrl, {timeout: 8_000, retryCount: 0})});
    const {balance, blockNumber} = await readVerifiedArcBalance({
      getChainId: () => rpc.getChainId(),
      getBlock: () => rpc.getBlock(),
      readBalance: block => rpc.readContract({address: ARC.usdc, abi: erc20Abi, functionName: "balanceOf", args: [wallet.address], blockNumber: block}),
    });
    return {...base, status: "verified", message: "Circle wallet identity verified. USDC balance read directly from Arc Mainnet.", address: wallet.address, balanceUsdc: formatUnits(balance, ARC.decimals), blockNumber: blockNumber.toString(), checkedAt: Date.now(), explorerUrl: `${ARC.explorer}/address/${wallet.address}`};
  } catch {
    return {...base, status: "unavailable", message: "Wallet verification is temporarily unavailable. No verified balance is displayed."};
  }
}

/** Bound repeated public reads and coalesce concurrent requests; failures expire quickly. */
export async function getAgentWalletStatus(): Promise<AgentWalletStatus> {
  if (cache && cache.expiresAt > Date.now()) return cache.value;
  if (!pending) pending = observe().then(value => {
    cache = {expiresAt: Date.now() + (value.status === "verified" ? 30_000 : 5_000), value};
    return value;
  }).finally(() => {pending = null;});
  return pending;
}
