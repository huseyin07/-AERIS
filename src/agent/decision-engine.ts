import type {AerisAnswer} from "@/ai/deterministic";
import type {IntelligenceSnapshot} from "@/intelligence/types";
import {evaluateSpendPolicy} from "./policy";
import type {AgentPhase, AgentPolicy, PolicyDecision} from "./types";

export type ActionKind = "inspect-address" | "inspect-transfer" | "focus-network" | "spend-usdc";
export type ActionStatus = "proposed" | "blocked" | "approval-required" | "ready" | "verified" | "failed";

export type ProposedAction = {
  id: string;
  kind: ActionKind;
  label: string;
  status: ActionStatus;
  amountUsdc?: number;
  address?: string;
  transferId?: string;
  policy: PolicyDecision;
  phases: AgentPhase[];
  verification: {verified: boolean; message: string};
};

const safeDecision: PolicyDecision = {allowed: true, requiresApproval: false, reason: "Read-only inspection is allowed."};

export function proposeObservationAction(answer: AerisAnswer, snapshot: IntelligenceSnapshot, _policy: AgentPolicy, _spentTodayUsdc = 0, observedTransferIds?: ReadonlySet<string>): ProposedAction {
  const now = snapshot.generatedAt;
  const transferId = answer.relatedTransferIds[0];
  const address = answer.relatedAddresses[0];
  if (transferId) {
    const exists = observedTransferIds ? observedTransferIds.has(transferId) : snapshot.topFlows.some(item => item.id === transferId);
    return {id: `inspect-transfer-${now}`, kind: "inspect-transfer", label: "Inspect verified transfer", status: exists ? "verified" : "failed", transferId, policy: safeDecision, phases: ["observe","analyze","plan","policy-check","verify","memory"], verification: {verified: exists, message: exists ? "Transfer exists in the current verified snapshot." : "Transfer is no longer present in the current snapshot."}};
  }
  if (address) {
    const exists = snapshot.entities.some(item => item.address.toLowerCase() === address.toLowerCase());
    return {id: `inspect-address-${now}`, kind: "inspect-address", label: "Inspect verified entity", status: exists ? "verified" : "failed", address, policy: safeDecision, phases: ["observe","analyze","plan","policy-check","verify","memory"], verification: {verified: exists, message: exists ? "Entity exists in the current verified snapshot." : "Entity is no longer present in the current snapshot."}};
  }
  return {id: `focus-network-${now}`, kind: "focus-network", label: "Review current verified network", status: "verified", policy: safeDecision, phases: ["observe","analyze","plan","policy-check","verify","memory"], verification: {verified: true, message: "Analysis is grounded in the current verified observation snapshot."}};
}

export function proposeSpendAction(amountUsdc: number, policy: AgentPolicy, spentTodayUsdc: number, service?: string, contract?: string): ProposedAction {
  const decision = evaluateSpendPolicy(policy, amountUsdc, spentTodayUsdc, service, contract);
  const status: ActionStatus = !decision.allowed ? "blocked" : decision.requiresApproval ? "approval-required" : "ready";
  return {id: `spend-${Date.now()}`, kind: "spend-usdc", label: `Spend ${amountUsdc} USDC`, status, amountUsdc, address: contract, policy: decision, phases: ["observe","analyze","plan","policy-check"], verification: {verified: false, message: status === "blocked" ? decision.reason : "No transaction has been executed. Execution and on-chain verification are separate steps."}};
}
