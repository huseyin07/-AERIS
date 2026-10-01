import type {AerisAnswer} from "@/ai/deterministic";
import type {IntelligenceSnapshot} from "@/intelligence/types";
import type {Connection} from "@/state/connection";
import type {ProposedAction} from "./decision-engine";
import type {AgentRun, AgentTask, EvidenceStrength, MemoryKind} from "./types";

const COOLDOWN_MS = 60_000;

export function planGoal(goal: string, now = Date.now()): AgentTask[] {
  const labels = ["Observe verified Arc activity","Detect material signals","Investigate strongest evidence","Evaluate policy","Verify outcome","Record memory"];
  return labels.map((label,index)=>({id:`task-${now}-${index}`,label,status:index===0?"running":"pending"}));
}

export function evidenceStrength(answer: AerisAnswer): EvidenceStrength {
  const verified = answer.evidence.filter(item => item.txHash || item.blockNumber || item.provenance || item.transferId).length;
  const independent = new Set(answer.evidence.map(item => item.txHash ?? item.transferId ?? item.address ?? item.text)).size;
  if (verified >= 3 && independent >= 2) return {level:"high",verifiedEvidence:verified,independentSignals:independent};
  if (verified >= 1 || independent >= 2) return {level:"medium",verifiedEvidence:verified,independentSignals:independent};
  return {level:"low",verifiedEvidence:verified,independentSignals:independent};
}

export function memoryKindFor(action: ProposedAction): MemoryKind {
  if (action.kind === "spend-usdc") return action.verification.verified ? "outcome" : "action";
  return "observation";
}

export function shouldTriggerProactively(args:{snapshot:IntelligenceSnapshot;connection:Connection;partial:boolean;lastRunAt:number|null;previousGeneratedAt:number|null;now?:number}) {
  const now=args.now ?? Date.now();
  if (args.connection !== "live" || args.partial) return {trigger:false,reason:"Verified live coverage is required."};
  if (!args.snapshot.transferCount || !args.snapshot.signals.length) return {trigger:false,reason:"No material deterministic signal is present."};
  if (args.previousGeneratedAt === args.snapshot.generatedAt) return {trigger:false,reason:"Snapshot has not changed."};
  if (args.lastRunAt && now-args.lastRunAt<COOLDOWN_MS) return {trigger:false,reason:"Proactive investigation cooldown is active."};
  const primary=args.snapshot.signals[0];
  if (primary.severity !== "notable" && primary.importance < 50) return {trigger:false,reason:"Signal does not cross the proactive threshold."};
  return {trigger:true,reason:`${primary.title}: ${primary.description}`};
}

export function createRun(args:{goal:string;trigger:"user"|"proactive";triggerReason:string;answer:AerisAnswer;action:ProposedAction;snapshot:IntelligenceSnapshot;now?:number}):AgentRun {
  const now=args.now ?? Date.now(); const strength=evidenceStrength(args.answer);
  return {id:`run-${now.toString(36)}`,createdAt:now,updatedAt:now,goal:args.goal,trigger:args.trigger,triggerReason:args.triggerReason,status:args.action.status==="failed"?"failed":args.action.status==="blocked"?"blocked":"completed",tasks:planGoal(args.goal,now).map(task=>({...task,status:"completed"})),action:args.action,evidence:strength,summary:args.answer.summary,observationReference:args.snapshot.generatedAt};
}

export function recoveryGate(connection:Connection, partial:boolean, action:ProposedAction) {
  if (connection !== "live") return {canAct:false,reason:"Economic actions are disabled unless Arc observation is live."};
  if (partial) return {canAct:false,reason:"Economic actions are disabled while Arc coverage is partial."};
  if (action.status==="failed" || action.status==="blocked") return {canAct:false,reason:action.policy.reason || action.verification.message};
  return {canAct:true,reason:"Observation health permits policy evaluation."};
}
