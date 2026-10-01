import "server-only";
import type {Hex} from "viem";

export type ExecutionRequest={to:`0x${string}`;amountUsdc:number;idempotencyKey:string;memo:string};
export type ExecutionResult={txHash:Hex;blockNumber:string;status:"confirmed";explorerUrl:string};

/**
 * Intentionally fail-closed until Circle credentials are configured and the
 * signing adapter is verified against the selected Arc environment.
 */
export async function executeArcUsdc(_request:ExecutionRequest):Promise<ExecutionResult>{
  throw new Error("Circle execution is not enabled.");
}
