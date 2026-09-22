import {formatUnits, isAddress} from "viem";
import type {Transfer} from "./types";

type TransferLog = {
  args?: {from?: unknown; to?: unknown; value?: unknown};
  transactionHash?: unknown;
  blockNumber?: bigint | null;
  logIndex?: number | null;
};

export function normalizeTransfer(log: TransferLog): Transfer | null {
  const {from, to, value} = log.args ?? {};
  if (
    typeof from !== "string" || !isAddress(from) ||
    typeof to !== "string" || !isAddress(to) ||
    typeof value !== "bigint" || value < 0n ||
    typeof log.transactionHash !== "string" || !/^0x[\da-f]{64}$/i.test(log.transactionHash) ||
    typeof log.blockNumber !== "bigint" ||
    typeof log.logIndex !== "number" || !Number.isSafeInteger(log.logIndex)
  ) return null;

  return {
    id: `${log.transactionHash}:${log.logIndex}`,
    txHash: log.transactionHash as `0x${string}`,
    blockNumber: log.blockNumber.toString(),
    logIndex: log.logIndex,
    from: from as `0x${string}`,
    to: to as `0x${string}`,
    value: formatUnits(value, 6),
    fromType: "unknown",
    toType: "unknown",
  };
}
