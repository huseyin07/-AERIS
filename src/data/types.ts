export type EntityType="wallet"|"contract"|"unknown";
export type Transfer={id:string;txHash:`0x${string}`;blockNumber:string;logIndex:number;from:`0x${string}`;to:`0x${string}`;value:string;fromType:EntityType;toType:EntityType};
export type ActivityResponse={network:string;chainId:number;latestBlock:string;transfers:Transfer[];fetchedAt:number};
