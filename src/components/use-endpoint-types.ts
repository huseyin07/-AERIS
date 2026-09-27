"use client";

import {useEffect, useMemo, useRef, useState} from "react";
import type {EntityType, Transfer} from "@/data/types";

type ClassificationResponse = {chainId: number; types: Record<string, EntityType>};
const validType = (value: unknown): value is EntityType => value === "wallet" || value === "contract";

/** Optional, bounded visual enrichment. Activity polling never waits for this hook. */
export function useEndpointTypes(transfers: readonly Transfer[]) {
  const [types, setTypes] = useState<Record<string, EntityType>>({});
  const retryAfter = useRef(new Map<string, number>());
  const targetKey = useMemo(() => [...new Set(transfers.slice(-16).flatMap(transfer => [
    ...(transfer.fromType === "unknown" ? [transfer.from.toLowerCase()] : []),
    ...(transfer.toType === "unknown" ? [transfer.to.toLowerCase()] : []),
  ]))].slice(0, 32).join(","), [transfers]);

  useEffect(() => {
    if (!targetKey) return;
    let stopped = false;
    let controller: AbortController | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const addresses = targetKey.split(",");
    const current = new Set(addresses);
    for (const address of retryAfter.current.keys()) if (!current.has(address)) retryAfter.current.delete(address);

    async function enrich() {
      const due = addresses.filter(address => (retryAfter.current.get(address) ?? 0) <= Date.now());
      for (let index = 0; index < due.length && !stopped; index += 6) {
        const batch = due.slice(index, index + 6);
        controller = new AbortController();
        const timeout = setTimeout(() => controller?.abort(), 10_000);
        try {
          const response = await fetch("/api/entity-types", {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({addresses: batch}), signal: controller.signal, cache: "no-store"});
          if (!response.ok) throw new Error("Classification unavailable");
          const data: ClassificationResponse = await response.json();
          if (data.chainId !== 5042 || !data.types || typeof data.types !== "object") throw new Error("Invalid classification response");
          if (stopped) return;
          const verified: Record<string, EntityType> = {};
          for (const address of batch) {
            const type = data.types[address];
            if (validType(type)) verified[address] = type;
            retryAfter.current.set(address, Date.now() + (validType(type) ? 5 * 60_000 : 60_000));
          }
          if (Object.keys(verified).length) setTypes(previous => {
            const next = {...previous, ...verified};
            const keys = Object.keys(next);
            for (const key of keys.slice(0, Math.max(0, keys.length - 512))) delete next[key];
            return next;
          });
        } catch {
          if (stopped) return;
          for (const address of batch) retryAfter.current.set(address, Date.now() + 30_000);
        } finally {
          clearTimeout(timeout);
          controller = null;
        }
      }
      if (!stopped) timer = setTimeout(enrich, 60_000);
    }

    timer = setTimeout(enrich, 250);
    return () => {stopped = true; if (timer) clearTimeout(timer); controller?.abort();};
  }, [targetKey]);

  return types;
}
