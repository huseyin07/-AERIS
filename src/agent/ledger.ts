import type {AgentRun, AgentLedgerEntry} from "./types";
export function ledgerEntry(run:AgentRun):AgentLedgerEntry {
  return {id:run.id,time:run.createdAt,trigger:run.trigger,decision:run.action.label,action:run.action.kind,costUsdc:run.action.amountUsdc ?? 0,status:run.status,proof:run.action.verification.verified ? run.action.verification.message : "Pending external/onchain proof"};
}
