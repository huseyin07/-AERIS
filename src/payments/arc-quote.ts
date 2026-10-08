import { createPublicClient, erc20Abi, formatUnits, http } from "viem";
import { ARC, arcChain } from "../data/arc";
import { PAYMENT_TOKEN, paymentData, units, type Invoice } from "./core";
export async function quoteArcTransfer(payer: `0x${string}`, invoice: Invoice) {
  const rpc = createPublicClient({
    chain: arcChain,
    transport: http(ARC.rpcUrl, {
      fetchOptions: { cache: "no-store" },
      timeout: 8_000,
      retryCount: 0,
    }),
  });
  const [chainId, head] = await Promise.all([rpc.getChainId(), rpc.getBlock()]);
  const age = Date.now() - Number(head.timestamp) * 1000;
  if (
    chainId !== 5042 ||
    head.number === null ||
    age > 120_000 ||
    age < -30_000
  )
    throw new Error("Arc is not reporting a current mainnet block.");
  const [balance, native, gas, fees] = await Promise.all([
    rpc.readContract({
      address: PAYMENT_TOKEN,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [payer],
      blockNumber: head.number,
    }),
    rpc.getBalance({ address: payer, blockNumber: head.number }),
    rpc.estimateGas({
      account: payer,
      to: PAYMENT_TOKEN,
      data: paymentData(invoice),
      value: 0n,
    }),
    rpc.estimateFeesPerGas({ type: "eip1559" }),
  ]);
  const gasLimit = (gas * 120n + 99n) / 100n;
  const fee =
    (gasLimit * fees.maxFeePerGas + 999_999_999_999n) / 1_000_000_000_000n;
  const total = units(invoice.amountUsdc) + fee;
  if (balance < total || native < total * 1_000_000_000_000n)
    throw new Error(
      "Your Arc USDC balance cannot cover this transfer and its maximum network fee.",
    );
  return {
    chainId,
    payer,
    recipient: invoice.recipient,
    amountUsdc: invoice.amountUsdc,
    balanceUsdc: formatUnits(balance, 6),
    maximumFeeUsdc: formatUnits(fee, 6),
    totalUsdc: formatUnits(total, 6),
    gas: gasLimit.toString(),
    maxFeePerGas: fees.maxFeePerGas.toString(),
    maxPriorityFeePerGas: fees.maxPriorityFeePerGas.toString(),
    checkedAt: Date.now(),
    blockNumber: head.number.toString(),
  };
}
