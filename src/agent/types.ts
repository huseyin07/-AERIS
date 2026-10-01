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

export type MemoryKind = "observation" | "action" | "outcome";
export type TaskStatus = "pending" | "running" | "completed" | "blocked" | "failed";
export type AgentTask = {id: string; label: string; status: TaskStatus};
export type EvidenceStrength = {level: "low" | "medium" | "high"; verifiedEvidence: number; independentSignals: number};
export type AgentRun = {id: string; createdAt: number; updatedAt: number; goal: string; trigger: "user" | "proactive"; triggerReason: string; status: "completed" | "blocked" | "failed"; tasks: AgentTask[]; action: import("./decision-engine").ProposedAction; evidence: EvidenceStrength; summary: string; observationReference: number};
export type AgentLedgerEntry = {id:string; time:number; trigger:"user"|"proactive"; decision:string; action:string; costUsdc:number; status:string; proof:string};

export type AgentMemoryEntry = {
  id: string;
  kind: MemoryKind;
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
  runs: AgentRun[];
  ledger: AgentLedgerEntry[];
  lastProactiveRunAt: number | null;
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
