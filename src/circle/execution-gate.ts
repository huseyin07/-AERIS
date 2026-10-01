import type {AgentPolicy} from "@/agent/types";
import {evaluateSpendPolicy} from "@/agent/policy";
export function authorizeCircleExecution(input:{policy:AgentPolicy;amountUsdc:number;spentTodayUsdc:number;service?:string;contract?:string;live:boolean;partial:boolean;requestKey:string}){
 if(process.env.AERIS_CIRCLE_EXECUTION_ENABLED!=="true") return {allowed:false,reason:"Circle execution feature flag is disabled."};
 if(!input.requestKey.trim()) return {allowed:false,reason:"Missing request key."};
 if(!input.live) return {allowed:false,reason:"Arc observation is not live."};
 if(input.partial) return {allowed:false,reason:"Arc observation coverage is partial."};
 const policy=evaluateSpendPolicy(input.policy,input.amountUsdc,input.spentTodayUsdc,input.service,input.contract);
 if(!policy.allowed) return {allowed:false,reason:policy.reason};
 if(policy.requiresApproval) return {allowed:false,reason:"Policy requires human approval."};
 return {allowed:true,reason:"Circle execution gate passed."};
}
