import { decodeFunctionData, erc20Abi, formatUnits } from "viem";
import { PAYMENT_CHAIN, PAYMENT_TOKEN, units } from "../payments/core";
import {
  address,
  transferInvoice,
  type WalletProvider,
} from "../payments/visitor-wallet";
type Transaction = {
  id: string;
  refId?: string;
  txHash?: string;
  state?: string;
};
export function circleUserProvider(
  payer: string,
  walletId: string,
  post: (action: string, input: unknown) => Promise<{ challengeId?: string }>,
  execute: (challenge: string) => Promise<void>,
  transactions: () => Promise<Transaction[]>,
): WalletProvider {
  const owner = address(payer);
  return {
    async request({ method, params }) {
      if (method === "eth_accounts" || method === "eth_requestAccounts")
        return [owner];
      if (method === "eth_chainId") return "0x13b2";
      if (method !== "eth_sendTransaction")
        throw Error("Unsupported Circle wallet operation.");
      const tx = params?.[0] as {
        from: string;
        to: string;
        data: `0x${string}`;
        value: string;
        chainId: string;
        gas: string;
        maxFeePerGas: string;
      };
      if (
        !tx ||
        address(tx.from) !== owner ||
        address(tx.to) !== PAYMENT_TOKEN ||
        BigInt(tx.value) !== 0n ||
        Number(tx.chainId) !== PAYMENT_CHAIN
      )
        throw Error("Circle transfer details changed.");
      const decoded = decodeFunctionData({ abi: erc20Abi, data: tx.data });
      if (decoded.functionName !== "transfer")
        throw Error("Only exact USDC transfers are supported.");
      const [recipient, amount] = decoded.args as [string, bigint];
      const invoice = transferInvoice(
        recipient,
        formatUnits(amount, 6),
        "Circle user-approved USDC transfer",
      );
      const fee =
        (BigInt(tx.gas) * BigInt(tx.maxFeePerGas) + 999999999999n) /
        1000000000000n;
      if (
        invoice.recipient === owner ||
        units(invoice.amountUsdc) !== amount ||
        fee <= 0n
      )
        throw Error("Invalid Circle transfer.");
      const reference = crypto.randomUUID();
      const result = await post("transfer", {
        walletId,
        invoice,
        maximumFeeUsdc: formatUnits(fee, 6),
        idempotencyKey: reference,
      });
      if (!result.challengeId)
        throw Error(
          "Circle returned no approval challenge. Check existing requests before retrying.",
        );
      await execute(result.challengeId);
      // Read-only reconciliation. The submission itself is never repeated.
      for (let i = 0; i < 10; i++) {
        const rows = await transactions();
        const match = rows.find((t) => t.refId === reference);
        if (match?.txHash) return match.txHash;
        if (
          match &&
          ["FAILED", "DENIED", "CANCELLED"].includes(match.state ?? "")
        )
          throw Error(
            `Circle request ${match.state}. Check its activity before resolving the saved request.`,
          );
        await new Promise((resolve) => setTimeout(resolve, 3000));
      }
      throw Error(
        "Circle approval completed, but no hash is available yet. Refresh Circle activity and attach its hash to your saved request. Do not resend.",
      );
    },
  };
}
