import "server-only";
import {getCircleConfig} from "./config";

export async function circleWalletClient(): Promise<never> {
  getCircleConfig();
  throw new Error("Circle signing adapter is not enabled until wallet credentials and the verified SDK adapter are configured.");
}
