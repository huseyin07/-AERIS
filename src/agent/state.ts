import {DEFAULT_AGENT_GOAL, DEFAULT_AGENT_POLICY, type AgentMemoryEntry, type AgentState} from "./types";

const STORAGE_KEY = "aeris.agent.state.v1";
const MAX_MEMORY = 24;

function sessionId() {
  return `aeris-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createAgentState(now = Date.now()): AgentState {
  return {version: 1, sessionId: sessionId(), goal: DEFAULT_AGENT_GOAL, policy: {...DEFAULT_AGENT_POLICY}, memory: [], lastUpdatedAt: now};
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
      memory: parsed.memory.slice(-MAX_MEMORY),
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
