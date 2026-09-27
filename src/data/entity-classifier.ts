import type {EntityType, HexAddress} from "./types";

type CodeRpc = {
  getChainId(): Promise<number>;
  getBytecode(args: {address: HexAddress}): Promise<`0x${string}` | undefined>;
};

/** Optional visual enrichment. It never gates or mutates the activity response. */
export function createEntityClassifier(rpc: CodeRpc, now = Date.now) {
  const cache = new Map<string, {type: EntityType; expiresAt: number}>();
  const inFlight = new Map<string, Promise<EntityType>>();
  let chainCheck: Promise<number> | null = null;
  let active = 0;
  const waiting: Array<() => void> = [];
  let budgetStartedAt = now();
  let budgetUsed = 0;

  function takeBudget() {
    if (now() - budgetStartedAt >= 60_000) {budgetStartedAt = now(); budgetUsed = 0;}
    if (budgetUsed >= 96) return false;
    budgetUsed += 1;
    return true;
  }

  async function withSlot<T>(work: () => Promise<T>) {
    if (active >= 3) await new Promise<void>(resolve => waiting.push(resolve));
    else active += 1;
    try {return await work();}
    finally {const next = waiting.shift(); if (next) next(); else active -= 1;}
  }

  async function classify(addresses: readonly HexAddress[]) {
    if (addresses.length > 6) throw new Error("Too many addresses");
    chainCheck ??= rpc.getChainId().catch(error => {chainCheck = null; throw error;});
    if (await chainCheck !== 5042) {chainCheck = null; throw new Error("Unexpected RPC chain");}
    const result: Record<string, EntityType> = {};
    let next = 0;
    await Promise.all(Array.from({length: Math.min(3, addresses.length)}, async () => {
      while (next < addresses.length) {
        const address = addresses[next++].toLowerCase() as HexAddress;
        const cached = cache.get(address);
        if (cached && cached.expiresAt > now()) {result[address] = cached.type; continue;}
        let request = inFlight.get(address);
        if (!request) {
          if (!takeBudget()) {result[address] = "unknown"; continue;}
          request = withSlot(() => rpc.getBytecode({address})).then(code => {
            const type = code && code !== "0x" ? "contract" : "wallet";
            cache.delete(address);
            cache.set(address, {type, expiresAt: now() + 5 * 60_000});
            while (cache.size > 4_096) cache.delete(cache.keys().next().value!);
            return type;
          }).catch(() => "unknown" as const).finally(() => {inFlight.delete(address);});
          inFlight.set(address, request);
        }
        result[address] = await request;
      }
    }));
    return result;
  }

  return classify;
}
