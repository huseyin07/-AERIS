/** Keep wallet balances tied to a current, verified Arc Mainnet block. */
export async function readVerifiedArcBalance(input: {
  getChainId: () => Promise<number>;
  getBlock: () => Promise<{number: bigint | null; timestamp: bigint}>;
  readBalance: (block: bigint) => Promise<bigint>;
  now?: () => number;
}) {
  const [chainId, head] = await Promise.all([input.getChainId(), input.getBlock()]);
  if (chainId !== 5042 || head.number === null) throw new Error("Wrong or unverified network.");
  const age = (input.now ?? Date.now)() - Number(head.timestamp) * 1_000;
  if (age > 120_000 || age < -30_000) throw new Error("Arc head is not current.");
  const balance = await input.readBalance(head.number);
  return {balance, blockNumber: head.number};
}
