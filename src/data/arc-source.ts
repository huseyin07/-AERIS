import {createPublicClient, http, parseAbiItem, type PublicClient} from "viem";
import {ARC, createArcChain, getArcConfiguration, safeArcConfigurationContext} from "./arc";
import {normalizeTransfer} from "./normalize";
import type {EntityType, Transfer} from "./types";

const transferEvent = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");
const MAX_TRANSFERS = 160;
const MAX_CLASSIFIED_ADDRESSES = 16;

export type ActivityFailureCode =
  | "RPC_CONNECTION_FAILED"
  | "CHAIN_ID_MISMATCH"
  | "LATEST_BLOCK_FAILED"
  | "USDC_LOG_QUERY_FAILED"
  | "USDC_CONFIGURATION_INVALID"
  | "NORMALIZATION_FAILED";

export class ActivityPipelineError extends Error {
  constructor(
    readonly code: ActivityFailureCode,
    message: string,
    readonly context: Record<string, unknown> = {},
    options?: {cause?: unknown},
  ) {
    super(message, options);
    this.name = "ActivityPipelineError";
  }
}

function errorSummary(error: unknown) {
  if (!(error instanceof Error)) return {type: typeof error};
  return {
    type: error.name,
    message: error.message.slice(0, 240),
  };
}

function createClient(timeout: number, retryCount: number) {
  let config;
  try {
    config = getArcConfiguration();
  } catch (error) {
    throw new ActivityPipelineError(
      "USDC_CONFIGURATION_INVALID",
      "Arc Mainnet configuration is invalid",
      safeArcConfigurationContext(),
      {cause: error},
    );
  }
  const chain = createArcChain(config);
  return {
    config,
    client: createPublicClient({chain, transport: http(config.rpcUrl, {timeout, retryCount, retryDelay: 250})}),
  };
}

async function classify(client: PublicClient, addresses: `0x${string}`[]) {
  const result = new Map<`0x${string}`, EntityType>();
  const selected = addresses.slice(0, MAX_CLASSIFIED_ADDRESSES);
  const entries = await Promise.all(selected.map(async address => {
    try {
      const bytecode = await client.getBytecode({address});
      return [address, bytecode ? "contract" : "wallet"] as const;
    } catch {
      return [address, "unknown"] as const;
    }
  }));
  entries.forEach(([address, type]) => result.set(address, type));
  return result;
}

export async function getRecentActivity(blocks = 18) {
  const {client, config} = createClient(8_000, 1);

  let chainId: number;
  try {
    chainId = await client.getChainId();
  } catch (error) {
    throw new ActivityPipelineError(
      "RPC_CONNECTION_FAILED",
      "Arc Mainnet RPC did not answer eth_chainId",
      safeArcConfigurationContext(),
      {cause: error},
    );
  }
  if (chainId !== ARC.chainId) {
    throw new ActivityPipelineError(
      "CHAIN_ID_MISMATCH",
      `Configured RPC returned chain ${chainId}; Arc Mainnet requires ${ARC.chainId}`,
      {...safeArcConfigurationContext(), returnedChainId: chainId},
    );
  }

  let latestBlock: bigint;
  try {
    latestBlock = await client.getBlockNumber();
  } catch (error) {
    throw new ActivityPipelineError(
      "LATEST_BLOCK_FAILED",
      "Arc Mainnet RPC failed eth_blockNumber",
      safeArcConfigurationContext(),
      {cause: error},
    );
  }

  const fromBlock = latestBlock > BigInt(blocks) ? latestBlock - BigInt(blocks) : 0n;
  let logs;
  try {
    logs = await client.getLogs({address: config.usdc, event: transferEvent, fromBlock, toBlock: latestBlock});
  } catch (error) {
    throw new ActivityPipelineError(
      "USDC_LOG_QUERY_FAILED",
      "Arc Mainnet RPC failed the native USDC Transfer log query",
      {
        ...safeArcConfigurationContext(),
        fromBlock: fromBlock.toString(),
        toBlock: latestBlock.toString(),
        blockCount: blocks,
      },
      {cause: error},
    );
  }

  let normalized: Array<Transfer | null>;
  try {
    normalized = logs.map(normalizeTransfer);
  } catch (error) {
    throw new ActivityPipelineError(
      "NORMALIZATION_FAILED",
      "Native USDC Transfer log normalization threw",
      {logCount: logs.length},
      {cause: error},
    );
  }
  const valid = normalized.filter((item): item is Transfer => item !== null);
  const rejectedLogCount = normalized.length - valid.length;
  const raw = valid.slice(-MAX_TRANSFERS);
  if (logs.length > 0 && raw.length === 0) {
    throw new ActivityPipelineError(
      "NORMALIZATION_FAILED",
      "The RPC returned Transfer logs but none matched the expected schema",
      {logCount: logs.length, rejectedLogCount},
    );
  }
  if (rejectedLogCount > 0) {
    console.warn("AERIS_ACTIVITY_WARNING", {
      code: "NORMALIZATION_FAILED",
      message: "Some native USDC logs were rejected",
      logCount: logs.length,
      rejectedLogCount,
    });
  }

  const addresses = [...new Set(raw.flatMap(item => [item.from, item.to]))];
  let kinds = new Map<`0x${string}`, EntityType>();
  if (addresses.length) {
    try {
      const classification = createClient(1_500, 0);
      kinds = await classify(classification.client, addresses);
    } catch (error) {
      // Classification is enrichment only. Never discard valid transfers because it failed.
      console.warn("AERIS_ACTIVITY_WARNING", {
        code: "ENTITY_CLASSIFICATION_FAILED",
        ...safeArcConfigurationContext(),
        ...errorSummary(error),
      });
    }
  }

  return {
    latestBlock,
    transfers: raw.map(transfer => ({
      ...transfer,
      fromType: kinds.get(transfer.from) ?? "unknown",
      toType: kinds.get(transfer.to) ?? "unknown",
    })),
    diagnostics: {
      queriedFromBlock: fromBlock,
      logCount: logs.length,
      rejectedLogCount,
      classifiedAddressCount: kinds.size,
    },
  };
}

export function activityErrorLog(error: unknown) {
  if (error instanceof ActivityPipelineError) {
    return {
      event: "AERIS_ACTIVITY_FAILURE",
      code: error.code,
      message: error.message,
      context: error.context,
      cause: errorSummary(error.cause),
    };
  }
  return {
    event: "AERIS_ACTIVITY_FAILURE",
    code: "RPC_CONNECTION_FAILED" as const,
    message: "Unexpected activity pipeline failure",
    context: safeArcConfigurationContext(),
    cause: errorSummary(error),
  };
}
