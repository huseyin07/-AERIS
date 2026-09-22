import type {EntityType, Transfer} from "@/data/types";

export type RankedAddress = {address: string; type: EntityType; sent: number; received: number; transferCount: number; uniqueCounterparties: number};
export type RankedFlow = {id: string; txHash: Transfer["txHash"]; from: Transfer["from"]; to: Transfer["to"]; amount: number; blockNumber: string};
export type ActivityCategory = `${EntityType}-to-${EntityType}`;
export type ActivitySlice = {category: ActivityCategory; count: number; volume: number; transferPercent: number; volumePercent: number};
export type AerisSignal = {
  id: string;
  type: "large-flow" | "flow-concentration" | "receiver-concentration" | "contract-activity" | "activity-mix";
  severity: "information" | "notable";
  title: string;
  description: string;
  relatedAddresses: string[];
  relatedTransferIds: string[];
  metric: {value: number; unit: "USDC" | "percent" | "count"};
};
export type IntelligenceSnapshot = {
  generatedAt: number;
  transferCount: number;
  totalVolume: number;
  uniqueAddresses: number;
  activeContracts: number;
  largestTransfer: RankedFlow | null;
  topFlows: RankedFlow[];
  topSenders: RankedAddress[];
  topReceivers: RankedAddress[];
  topContracts: RankedAddress[];
  concentration: {largestTransferPercent: number; topThreePercent: number; topReceiverPercent: number};
  activityBreakdown: ActivitySlice[];
  signals: AerisSignal[];
};
