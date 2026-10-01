export type AgentPhase = "observe" | "analyze" | "plan" | "policy-check" | "act" | "verify" | "memory";

export type AgentPolicy = {
  maxTransactionUsdc: number;
  dailyBudgetUsdc: number;
  autoExecute: boolean;
  requireApprovalAboveUsdc: number;
  emergencyStop: boolean;
  allowedServices: string[];
  allowedContracts: string[];
};

export type AgentMemoryEntry = {
  id: string;
  createdAt: number;
  query: string;
  summary: string;
  subject: string | null;
  relatedTransferIds: string[];
  evidenceCount: number;
  observationReference: number;
};

export type AgentState = {
  version: 1;
  sessionId: string;
  goal: string;
  policy: AgentPolicy;
  memory: AgentMemoryEntry[];
  lastUpdatedAt: number;
};

export type PolicyDecision = {
  allowed: boolean;
  reason: string;
  requiresApproval: boolean;
};

export const DEFAULT_AGENT_POLICY: AgentPolicy = {
  maxTransactionUsdc: 1,
  dailyBudgetUsdc: 5,
  autoExecute: false,
  requireApprovalAboveUsdc: 0.5,
  emergencyStop: false,
  allowedServices: [],
  allowedContracts: [],
};

export const DEFAULT_AGENT_GOAL = "Observe verified Arc Mainnet USDC activity and explain material changes using only verifiable evidence.";
