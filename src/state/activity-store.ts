import {create} from "zustand";
import type {EntityType, Transfer} from "@/data/types";
import type {VisualizationIntent} from "@/intelligence/intents";
import {connectionAfterFailure, type Connection} from "./connection";

type State = {
  transfers: Transfer[];
  connection: Connection;
  selected: string | null;
  query: string;
  visualizationIntent: VisualizationIntent;
  mergeTransfers: (transfers: Transfer[]) => void;
  markRequestSucceeded: () => void;
  markRequestFailed: () => void;
  select: (address: string | null) => void;
  setQuery: (query: string) => void;
  setVisualizationIntent: (intent: VisualizationIntent) => void;
};

const entityTypes = new Set<EntityType>(["wallet", "contract", "unknown"]);
const addressPattern = /^0x[\da-f]{40}$/i;
const hashPattern = /^0x[\da-f]{64}$/i;

function validTransfer(value: unknown): value is Transfer {
  if (!value || typeof value !== "object") return false;
  const transfer = value as Partial<Transfer>;
  return typeof transfer.id === "string" &&
    typeof transfer.from === "string" && addressPattern.test(transfer.from) &&
    typeof transfer.to === "string" && addressPattern.test(transfer.to) &&
    typeof transfer.txHash === "string" && hashPattern.test(transfer.txHash) &&
    typeof transfer.blockNumber === "string" && /^\d+$/.test(transfer.blockNumber) &&
    typeof transfer.value === "string" && Number.isFinite(Number(transfer.value)) && Number(transfer.value) >= 0 &&
    typeof transfer.logIndex === "number" && Number.isSafeInteger(transfer.logIndex) &&
    entityTypes.has(transfer.fromType as EntityType) && entityTypes.has(transfer.toType as EntityType);
}

export const useActivity = create<State>(set => ({
  transfers: [],
  connection: "connecting",
  selected: null,
  query: "",
  visualizationIntent: {type: "reset"},
  mergeTransfers: incoming => set(state => {
    const merged = new Map(state.transfers.map(transfer => [transfer.id, transfer]));
    incoming.filter(validTransfer).forEach(transfer => merged.set(transfer.id, transfer));
    return {
      transfers: [...merged.values()]
        .sort((left, right) => left.blockNumber === right.blockNumber
          ? left.logIndex - right.logIndex
          : left.blockNumber.length - right.blockNumber.length || left.blockNumber.localeCompare(right.blockNumber))
        .slice(-240),
    };
  }),
  markRequestSucceeded: () => set({connection: "live"}),
  markRequestFailed: () => set(state => ({connection: connectionAfterFailure(state.transfers.length)})),
  select: selected => set({selected}),
  setQuery: query => set({query}),
  setVisualizationIntent: visualizationIntent => set({visualizationIntent}),
}));
