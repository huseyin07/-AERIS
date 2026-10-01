import "server-only";
import {getCircleConfig} from "./config";

export async function circleWalletClient() {
  const config = getCircleConfig();
  const {initiateDeveloperControlledWalletsClient} = await import("@circle-fin/developer-controlled-wallets");
  return initiateDeveloperControlledWalletsClient({
    apiKey: config.apiKey,
    entitySecret: config.entitySecret,
  });
}
