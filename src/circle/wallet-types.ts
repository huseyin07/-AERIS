export type AgentWalletStatus = {
  status: "not-configured" | "verified" | "unavailable";
  network: "Arc Mainnet";
  chainId: 5042;
  execution: "disabled";
  message: string;
  address?: string;
  balanceUsdc?: string;
  blockNumber?: string;
  checkedAt?: number;
  explorerUrl?: string;
};
