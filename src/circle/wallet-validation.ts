export type VerifiedCircleWallet = {address: `0x${string}`; blockchain: string};

/** Verify identity before presenting any Circle wallet as the AERIS agent. */
export function validateCircleWallet(value: unknown, walletId: string, address: string): VerifiedCircleWallet {
  const wallet = value as Record<string, unknown> | null;
  if (!wallet || wallet.id !== walletId || typeof wallet.address !== "string" ||
      wallet.address.toLowerCase() !== address.toLowerCase()) throw new Error("Circle wallet identity mismatch.");
  if (wallet.custodyType !== "DEVELOPER" || wallet.accountType !== "EOA" || wallet.state !== "LIVE") {
    throw new Error("A live developer-controlled EOA is required.");
  }
  // Generic EVM wallets can be used on Arc; testnet and other chain-specific wallets cannot.
  if (wallet.blockchain !== "EVM" && wallet.blockchain !== "ARC") throw new Error("Circle wallet is not configured for Arc Mainnet.");
  return {address: wallet.address as `0x${string}`, blockchain: wallet.blockchain};
}
