import "server-only";
import {getCircleReadConfig} from "./config";
import {validateCircleWallet} from "./wallet-validation";

export async function circleWalletClient() {
  const config = getCircleReadConfig();
  const response = await fetch(`https://api.circle.com/v1/w3s/wallets/${encodeURIComponent(config.walletId)}`, {
    headers: {Authorization: `Bearer ${config.apiKey}`},
    cache: "no-store",
    signal: AbortSignal.timeout(8_000),
  });
  // Never expose provider response bodies, account identifiers or credentials in errors.
  if (!response.ok) throw new Error("Circle wallet lookup failed.");
  const body = await response.json();
  return validateCircleWallet(body?.data?.wallet, config.walletId, config.walletAddress);
}
