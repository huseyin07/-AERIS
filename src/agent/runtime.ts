import type {AerisAnswer} from "@/ai/deterministic";
import type {IntelligenceSnapshot} from "@/intelligence/types";
import type {Connection} from "@/state/connection";
import type {ProposedAction} from "./decision-engine";
import type {AgentRun, AgentTask, EvidenceStrength, MemoryKind, ProofRef} from "./types";

const COOLDOWN_MS = 60_000;

export function planGoal(_goal: string, now = Date.now()): AgentTask[] {
  return ["Observe verified Arc activity","Analyze material signal","Plan investigation","Evaluate deterministic policy","Act on read-only investigation","Verify evidence","Record memory"]
    .map((label,index)=>({id:`task-${now}-${index}`,label,status:index===0?"running":"pending"}));
}

export function evidenceStrength(answer: AerisAnswer): EvidenceStrength {
  const verified=answer.evidence.filter(item=>item.txHash||item.blockNumber||item.provenance||item.transferId).length;
  const independent=new Set(answer.evidence.map(item=>item.txHash??item.transferId??item.address??item.text)).size;
  if(verified>=3&&independent>=2)return {level:"high",verifiedEvidence:verified,independentSignals:independent};
  if(verified>=1||independent>=2)return {level:"medium",verifiedEvidence:verified,independentSignals:independent};
  return {level:"low",verifiedEvidence:verified,independentSignals:independent};
}

export function proofRefs(answer:AerisAnswer,snapshot:IntelligenceSnapshot):ProofRef[]{
  const refs:ProofRef[]=[{kind:"observation",label:"Observation reference",value:new Date(snapshot.generatedAt).toISOString()}];
  for(const item of answer.evidence){
    if(item.txHash) refs.push({kind:"transaction",label:"Verified transaction",value:item.txHash});
    if(item.blockNumber) refs.push({kind:"block",label:"Verified block",value:item.blockNumber});
    if(item.address) refs.push({kind:"address",label:"Observed address",value:item.address});
  }
  return refs.filter((item,index,all)=>all.findIndex(other=>other.kind===item.kind&&other.value===item.value)===index).slice(0,8);
}

export function memoryKindFor(action: ProposedAction): MemoryKind {
  if(action.kind==="spend-usdc") return action.verification.verified?"outcome":"action";
  return "observation";
}

export function sentinelSignature(snapshot:IntelligenceSnapshot){
  const primary=snapshot.signals[0];
  return primary?`${primary.title}|${primary.relatedTransferIds.slice(0,3).join(",")}|${primary.relatedAddresses.slice(0,3).join(",")}`:"";
}

export function shouldTriggerProactively(args:{snapshot:IntelligenceSnapshot;connection:Connection;partial:boolean;lastRunAt:number|null;lastSignature?:string|null;previousGeneratedAt:number|null;now?:number}){
  const now=args.now??Date.now();
  if(args.connection!=="live"||args.partial)return {trigger:false,reason:"Verified live coverage is required.",signature:""};
  if(!args.snapshot.transferCount||!args.snapshot.signals.length)return {trigger:false,reason:"No material deterministic signal is present.",signature:""};
  if(args.previousGeneratedAt===args.snapshot.generatedAt)return {trigger:false,reason:"Snapshot has not changed.",signature:""};
  const primary=args.snapshot.signals[0]; const signature=sentinelSignature(args.snapshot);
  if(args.lastSignature===signature)return {trigger:false,reason:"Sentinel already investigated this signal.",signature};
  if(args.lastRunAt&&now-args.lastRunAt<COOLDOWN_MS)return {trigger:false,reason:"Proactive investigation cooldown is active.",signature};
  if(primary.severity!=="notable"&&primary.importance<50)return {trigger:false,reason:"Signal does not cross the proactive threshold.",signature};
  return {trigger:true,reason:`${primary.title}: ${primary.description}`,signature};
}

function lifecycleTasks(action:ProposedAction,now:number):AgentTask[]{
  const tasks=planGoal("",now);
  const failed=action.status==="failed";
  const blocked=action.status==="blocked";
  const approval=action.status==="approval-required";
  const economic=action.kind==="spend-usdc";
  return tasks.map((task,index)=>{
    if(index<=3)return {...task,status:"completed"};
    if(index===4){
      if(failed||blocked)return {...task,status:"blocked"};
      if(approval)return {...task,status:"pending"};
      if(economic&&action.status==="ready")return {...task,status:"pending"};
      return {...task,status:"completed"};
    }
    if(index===5){
      if(failed||blocked||approval||(economic&&!action.verification.verified))return {...task,status:"pending"};
      return {...task,status:action.verification.verified?"completed":"pending"};
    }
    if(failed||blocked||approval||(economic&&!action.verification.verified))return {...task,status:"pending"};
    return {...task,status:"completed"};
  });
}

export function createRun(args:{goal:string;trigger:"user"|"proactive";triggerReason:string;triggerSignature?:string|null;answer:AerisAnswer;action:ProposedAction;snapshot:IntelligenceSnapshot;now?:number}):AgentRun{
  const now=args.now??Date.now(); const strength=evidenceStrength(args.answer);
  const status=args.action.status==="failed"?"failed":args.action.status==="blocked"?"blocked":"completed";
  return {id:`run-${now.toString(36)}`,createdAt:now,updatedAt:now,goal:args.goal,trigger:args.trigger,triggerReason:args.triggerReason,triggerSignature:args.triggerSignature??null,status,tasks:lifecycleTasks(args.action,now),action:args.action,evidence:strength,proofs:proofRefs(args.answer,args.snapshot),summary:args.answer.summary,observationReference:args.snapshot.generatedAt};
}

export function recoveryGate(connection:Connection,partial:boolean,action:ProposedAction){
  if(connection!=="live")return {canAct:false,reason:"Economic actions are disabled unless Arc observation is live."};
  if(partial)return {canAct:false,reason:"Economic actions are disabled while Arc coverage is partial."};
  if(action.status==="failed"||action.status==="blocked")return {canAct:false,reason:action.policy.reason||action.verification.message};
  return {canAct:true,reason:"Observation health permits policy evaluation."};
}
