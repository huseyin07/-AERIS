import type {Transfer} from "@/data/types";
import type {IntelligenceSnapshot} from "@/intelligence/types";

export function createIntelligenceTools(snapshot: IntelligenceSnapshot, transfers: readonly Transfer[]) {
  return {
    getNetworkSummary: () => ({transferCount: snapshot.transferCount, totalVolume: snapshot.totalVolume, uniqueAddresses: snapshot.uniqueAddresses, activeContracts: snapshot.activeContracts}),
    getLargestFlows: (limit = 5) => snapshot.topFlows.slice(0, Math.max(0, Math.min(limit, 20))),
    getTopSenders: (limit = 5) => snapshot.topSenders.slice(0, Math.max(0, Math.min(limit, 20))),
    getTopReceivers: (limit = 5) => snapshot.topReceivers.slice(0, Math.max(0, Math.min(limit, 20))),
    getActiveContracts: (limit = 5) => snapshot.topContracts.slice(0, Math.max(0, Math.min(limit, 20))),
    getAddressActivity: (address: string) => {
      const normalized = address.toLowerCase();
      const related = transfers.filter(item => item.from.toLowerCase() === normalized || item.to.toLowerCase() === normalized);
      if (!related.length) return null;
      return {address, transferCount: related.length, sent: related.reduce((sum, item) => sum + (item.from.toLowerCase() === normalized ? Number(item.value) : 0), 0), received: related.reduce((sum, item) => sum + (item.to.toLowerCase() === normalized ? Number(item.value) : 0), 0), uniqueCounterparties: new Set(related.map(item => item.from.toLowerCase() === normalized ? item.to : item.from)).size, transferIds: related.map(item => item.id)};
    },
    getFlowConcentration: () => snapshot.concentration,
    getActivityBreakdown: () => snapshot.activityBreakdown,
    getCurrentSignals: () => snapshot.signals,
  };
}
