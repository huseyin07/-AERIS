import type {EntityType} from "@/data/types";
export type VisualizationIntent =
  | {type: "highlight-transfers"; transferIds: string[]}
  | {type: "highlight-addresses"; addresses: string[]}
  | {type: "filter-entity-type"; entityType: EntityType}
  | {type: "focus-address-activity"; address: string}
  | {type: "isolate-network"; addresses: string[]; transferIds: string[]}
  | {type: "filter-transfers"; direction?: "incoming" | "outgoing"; address?: string; minimumAmount?: number}
  | {type: "reset"};
