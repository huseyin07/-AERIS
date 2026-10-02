import type {AgentPolicy, PolicyDecision} from "./types";

export function evaluateSpendPolicy(policy: AgentPolicy, amountUsdc: number, spentTodayUsdc: number, service?: string, contract?: string): PolicyDecision {
  if (policy.emergencyStop) return {allowed: false, requiresApproval: false, reason: "Emergency stop is active."};
  if (!Number.isFinite(amountUsdc) || amountUsdc <= 0) return {allowed: false, requiresApproval: false, reason: "Spend amount must be positive and finite."};
  if (amountUsdc > policy.maxTransactionUsdc) return {allowed: false, requiresApproval: false, reason: `Amount exceeds the ${policy.maxTransactionUsdc} USDC per-action limit.`};
  if (spentTodayUsdc + amountUsdc > policy.dailyBudgetUsdc) return {allowed: false, requiresApproval: false, reason: "Daily autonomous budget would be exceeded."};
  if (service && policy.allowedServices.length && !policy.allowedServices.includes(service)) return {allowed: false, requiresApproval: false, reason: "Service is not on the policy allowlist."};
  if (contract && policy.allowedContracts.length && !policy.allowedContracts.map(item => item.toLowerCase()).includes(contract.toLowerCase())) return {allowed: false, requiresApproval: false, reason: "Contract is not on the policy allowlist."};
  const requiresApproval = !policy.autoExecute || amountUsdc > policy.requireApprovalAboveUsdc;
  return {allowed: true, requiresApproval, reason: requiresApproval ? "Policy allows the action, but human approval is required." : "Policy allows autonomous execution."};
}
