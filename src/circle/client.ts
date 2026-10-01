import "server-only";
import {initiateDeveloperControlledWalletsClient} from "@circle-fin/developer-controlled-wallets";
import {getCircleConfig} from "./config";
export function circleWalletClient(){const c=getCircleConfig();return initiateDeveloperControlledWalletsClient({apiKey:c.apiKey,entitySecret:c.entitySecret});}
