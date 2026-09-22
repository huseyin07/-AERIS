import type {Transfer} from "@/data/types";
import {getEntityIntelligence} from "../intelligence/engine.ts";
import type {IntelligenceSnapshot} from "@/intelligence/types";

export function createIntelligenceTools(snapshot: IntelligenceSnapshot, transfers: readonly Transfer[]) {
  return {
    getCurrentActivitySummary: () => ({observationWindow: "rolling-10-minutes" as const, economic: {transferCount: snapshot.transferCount, totalVolumeUSDC: snapshot.totalVolume, uniqueAddresses: snapshot.uniqueAddresses}, activity: snapshot.networkActivity, concentration: snapshot.concentration}),
    getNetworkSummary: () => ({economic: {transferCount: snapshot.transferCount, totalVolumeUSDC: snapshot.totalVolume}, activity: snapshot.networkActivity}),
    getLargestFlows: (limit = 5) => snapshot.topFlows.slice(0, Math.max(0, Math.min(limit, 20))),
    getTopSenders: (limit = 5) => snapshot.topSenders.slice(0, Math.max(0, Math.min(limit, 20))),
    getTopReceivers: (limit = 5) => snapshot.topReceivers.slice(0, Math.max(0, Math.min(limit, 20))),
    getActiveContracts: (limit = 5) => snapshot.topContracts.slice(0, Math.max(0, Math.min(limit, 20))),
    getEntityIntelligence: (address: string) => getEntityIntelligence(snapshot, address),
    getAddressActivity: (address: string) => getEntityIntelligence(snapshot, address),
    getCurrentSignals: () => snapshot.signals,
    getTransferDetails: (id: string) => transfers.find(item => item.id === id) ?? null,
    getFlowConcentration: () => snapshot.concentration,
    getActivityBreakdown: () => snapshot.activityBreakdown,
    getContractActivity: () => ({interactions: snapshot.networkActivity.contractInteractions, deployments: snapshot.networkActivity.contractDeployments, activeContracts: snapshot.networkActivity.activeContracts, concentrationPercent: snapshot.networkActivity.interactionConcentrationPercent}),
  };
}
