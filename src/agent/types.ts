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
export type ProofRef = {kind:"transaction"|"block"|"address"|"observation"; label:string; value:string; url?:string};
export type AgentRun = {id: string; createdAt: number; updatedAt: number; goal: string; trigger: "user" | "proactive"; triggerReason: string; triggerSignature: string | null; status: "completed" | "blocked" | "failed"; tasks: AgentTask[]; action: import("./decision-engine").ProposedAction; evidence: EvidenceStrength; proofs: ProofRef[]; summary: string; observationReference: number};
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
  signalSignature: string | null;
  observedVolume: number;
  transferCount: number;
  counterpartyCount: number;
};

export type BaselineBucket = {startedAt:number; endedAt:number; transferCount:number; totalVolume:number; sub1kCount:number; largeCount:number; uniqueAddresses:number};
export type AgentBaseline = {buckets:BaselineBucket[]; updatedAt:number};

export type AgentState = {
  version: 1;
  sessionId: string;
  goal: string;
  policy: AgentPolicy;
  memory: AgentMemoryEntry[];
  runs: AgentRun[];
  ledger: AgentLedgerEntry[];
  baseline: AgentBaseline;
  lastProactiveRunAt: number | null;
  lastProactiveSignature: string | null;
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
