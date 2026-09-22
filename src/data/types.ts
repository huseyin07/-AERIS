export type EntityType = "wallet" | "contract" | "unknown";
export type ActivityStatus = "success" | "failed" | "unknown";
export type HexAddress = `0x${string}`;
export type HexHash = `0x${string}`;

export type Transfer = {
  id: string;
  txHash: HexHash;
  blockNumber: string;
  blockHash?: HexHash;
  transactionIndex?: number;
  timestamp?: number;
  logIndex: number;
  from: HexAddress;
  to: HexAddress;
  value: string;
  amountRaw?: string;
  fromType: EntityType;
  toType: EntityType;
};

type ActivityBase = {
  id: string;
  chainId: 5042;
  blockNumber: string;
  blockHash: HexHash;
  transactionHash: HexHash;
  transactionIndex: number;
  timestamp: number;
  from: HexAddress;
  status: ActivityStatus;
  source: "arc-mainnet-rpc";
  observedAt: number;
  parentTransactionId: string;
};

export type UsdcTransferActivity = ActivityBase & {
  type: "USDC_TRANSFER";
  to: HexAddress;
  logIndex: number;
  amountRaw: string;
  amountUSDC: string;
  fromType: EntityType;
  toType: EntityType;
};

export type ContractCallActivity = ActivityBase & {
  type: "CONTRACT_CALL";
  to: HexAddress;
  inputSelector?: `0x${string}`;
};

export type ContractDeploymentActivity = ActivityBase & {
  type: "CONTRACT_DEPLOYMENT";
  to: HexAddress;
  deployedContract: HexAddress;
};

export type ArcActivityEvent = UsdcTransferActivity | ContractCallActivity | ContractDeploymentActivity;

export type ActivityResponse = {
  network: string;
  chainId: number;
  latestBlock: string;
  events: ArcActivityEvent[];
  transfers: Transfer[];
  observationWindowMs: number;
  fetchedAt: number;
};
