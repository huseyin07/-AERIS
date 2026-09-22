import {createPublicClient, http, parseAbiItem} from "viem";
import {ARC, arcChain} from "./arc";
import {normalizeTransfer} from "./normalize";
import type {EntityType, Transfer} from "./types";

const transferEvent = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");
const client = createPublicClient({
  chain: arcChain,
  transport: http(ARC.rpcUrl, {timeout: 8_000, retryCount: 1, retryDelay: 250}),
});

async function kind(address: `0x${string}`): Promise<EntityType> {
  try {
    return (await client.getBytecode({address})) ? "contract" : "wallet";
  } catch {
    return "unknown";
  }
}

async function classify(addresses: `0x${string}`[]) {
  const result = new Map<`0x${string}`, EntityType>();
  for (let offset = 0; offset < addresses.length; offset += 8) {
    const batch = addresses.slice(offset, offset + 8);
    const entries = await Promise.all(batch.map(async address => [address, await kind(address)] as const));
    entries.forEach(([address, type]) => result.set(address, type));
  }
  return result;
}

export async function getRecentActivity(blocks = 18) {
  const chainId = await client.getChainId();
  if (chainId !== ARC.chainId) {
    throw new Error(`Configured RPC returned chain ${chainId}; Arc Mainnet requires ${ARC.chainId}`);
  }

  const latestBlock = await client.getBlockNumber();
  const fromBlock = latestBlock > BigInt(blocks) ? latestBlock - BigInt(blocks) : 0n;
  // Arc native USDC exposes the standard ERC-20 Transfer event at its predeploy.
  const logs = await client.getLogs({address: ARC.usdc, event: transferEvent, fromBlock, toBlock: latestBlock});
  const raw = logs.map(normalizeTransfer).filter((item): item is Transfer => item !== null).slice(-160);
  const addresses = [...new Set(raw.flatMap(item => [item.from, item.to]))].slice(0, 80);
  const kinds = await classify(addresses);

  return {
    latestBlock,
    transfers: raw.map(transfer => ({
      ...transfer,
      fromType: kinds.get(transfer.from) ?? "unknown",
      toType: kinds.get(transfer.to) ?? "unknown",
    })),
  };
}
