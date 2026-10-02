import {DEFAULT_AGENT_GOAL, DEFAULT_AGENT_POLICY, type AgentMemoryEntry, type AgentState} from "./types";

const STORAGE_KEY = "aeris.agent.state.v1";
const MAX_MEMORY = 24;

function sessionId() {
  return `aeris-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createAgentState(now = Date.now()): AgentState {
  return {version: 1, sessionId: sessionId(), goal: DEFAULT_AGENT_GOAL, policy: {...DEFAULT_AGENT_POLICY}, memory: [], runs: [], ledger: [], baseline:{buckets:[],updatedAt:now}, lastProactiveRunAt: null, lastProactiveSignature: null, lastUpdatedAt: now};
}

export function loadAgentState(): AgentState {
  if (typeof window === "undefined") return createAgentState();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return createAgentState();
    const parsed = JSON.parse(raw) as Partial<AgentState>;
    if (parsed.version !== 1 || !Array.isArray(parsed.memory)) return createAgentState();
    return {
      version: 1,
      sessionId: typeof parsed.sessionId === "string" ? parsed.sessionId : sessionId(),
      goal: typeof parsed.goal === "string" && parsed.goal.trim() ? parsed.goal : DEFAULT_AGENT_GOAL,
      policy: {...DEFAULT_AGENT_POLICY, ...(parsed.policy ?? {})},
      memory: parsed.memory.map(item => ({...item, kind: item.kind ?? "observation"})).slice(-MAX_MEMORY),
      runs: Array.isArray(parsed.runs) ? parsed.runs.slice(-20) : [],
      ledger: Array.isArray(parsed.ledger) ? parsed.ledger.slice(-30) : [],
      baseline: parsed.baseline && Array.isArray(parsed.baseline.buckets) ? {buckets:parsed.baseline.buckets.slice(-144),updatedAt:typeof parsed.baseline.updatedAt==="number"?parsed.baseline.updatedAt:Date.now()} : {buckets:[],updatedAt:Date.now()},
      lastProactiveRunAt: typeof parsed.lastProactiveRunAt === "number" ? parsed.lastProactiveRunAt : null,
      lastProactiveSignature: typeof parsed.lastProactiveSignature === "string" ? parsed.lastProactiveSignature : null,
      lastUpdatedAt: typeof parsed.lastUpdatedAt === "number" ? parsed.lastUpdatedAt : Date.now(),
    };
  } catch {
    return createAgentState();
  }
}

export function saveAgentState(state: AgentState) {
  if (typeof window === "undefined") return;
  try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* storage is optional */ }
}

export function remember(state: AgentState, entry: AgentMemoryEntry): AgentState {
  return {...state, memory: [...state.memory, entry].slice(-MAX_MEMORY), lastUpdatedAt: entry.createdAt};
}

export function clearAgentMemory(state: AgentState, now = Date.now()): AgentState {
  return {...state, memory: [], lastUpdatedAt: now};
}

export function recordRun(state: AgentState, run: import("./types").AgentRun, ledger: import("./types").AgentLedgerEntry): AgentState {
  return {...state, runs:[...state.runs,run].slice(-20), ledger:[...state.ledger,ledger].slice(-30), lastProactiveRunAt:run.trigger==="proactive"?run.createdAt:state.lastProactiveRunAt, lastProactiveSignature:run.trigger==="proactive"?run.triggerReason:state.lastProactiveSignature, lastUpdatedAt:run.updatedAt};
}


export function recordBaseline(state:AgentState,args:{reference:number;transferCount:number;totalVolume:number;sub1kCount:number;largeCount:number;uniqueAddresses:number}):AgentState{
  const bucketMs=10*60_000; const startedAt=Math.floor(args.reference/bucketMs)*bucketMs; const endedAt=startedAt+bucketMs;
  const bucket={startedAt,endedAt,transferCount:args.transferCount,totalVolume:args.totalVolume,sub1kCount:args.sub1kCount,largeCount:args.largeCount,uniqueAddresses:args.uniqueAddresses};
  const buckets=[...state.baseline.buckets.filter(item=>item.startedAt!==startedAt&&item.endedAt>args.reference-24*60*60_000),bucket].sort((a,b)=>a.startedAt-b.startedAt).slice(-144);
  return {...state,baseline:{buckets,updatedAt:args.reference},lastUpdatedAt:Date.now()};
}

export function baselineSummary(state:AgentState,reference:number){
  const recent=state.baseline.buckets.filter(item=>item.endedAt>reference-60*60_000);
  const day=state.baseline.buckets.filter(item=>item.endedAt>reference-24*60*60_000);
  const average=(items:typeof day,key:"transferCount"|"totalVolume"|"sub1kCount"|"largeCount")=>items.length?items.reduce((sum,item)=>sum+item[key],0)/items.length:0;
  return {hourBuckets:recent.length,dayBuckets:day.length,hourAverageVolume:average(recent,"totalVolume"),dayAverageVolume:average(day,"totalVolume"),hourAverageTransfers:average(recent,"transferCount"),dayAverageTransfers:average(day,"transferCount")};
}
