"use client";

import {useEffect} from "react";
import type {ActivityResponse} from "@/data/types";
import {useActivity} from "@/state/activity-store";

const POLL_INTERVAL_MS = 6_000;
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_RETRY_DELAY_MS = 20_000;

function isActivityResponse(value: unknown): value is ActivityResponse {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<ActivityResponse>;
  return candidate.chainId === 5042 && Array.isArray(candidate.events) && Array.isArray(candidate.transfers);
}

export function LiveActivity() {
  const merge = useActivity(state => state.mergeActivity);
  const markRequestSucceeded = useActivity(state => state.markRequestSucceeded);
  const markRequestFailed = useActivity(state => state.markRequestFailed);

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | undefined;
    let consecutiveFailures = 0;

    async function load() {
      controller = new AbortController();
      const timeout = setTimeout(() => controller?.abort(), REQUEST_TIMEOUT_MS);
      let failedResponse: ActivityResponse | undefined;
      try {
        const response = await fetch("/api/activity", {signal: controller.signal});
        const data: unknown = await response.json();
        if (!isActivityResponse(data)) throw new Error("Malformed Arc Mainnet activity response");
        if (!response.ok || data.status === "error") { failedResponse = data; throw new Error(`Activity request failed (${response.status})`); }
        if (active) {
          const minimumBlockNumber = data.processedBlockRange?.from ? BigInt(data.processedBlockRange.from) : undefined;
          merge(data.events, data.windowReferenceTimestamp, minimumBlockNumber);
          consecutiveFailures = 0;
          markRequestSucceeded(data);
        }
      } catch {
        if (active) {
          consecutiveFailures += 1;
          markRequestFailed(failedResponse);
        }
      } finally {
        clearTimeout(timeout);
        if (active) {
          const retryDelay = consecutiveFailures === 0
            ? POLL_INTERVAL_MS
            : Math.min(POLL_INTERVAL_MS * 2 ** Math.min(consecutiveFailures - 1, 2), MAX_RETRY_DELAY_MS);
          timer = setTimeout(load, retryDelay);
        }
      }
    }

    void load();
    return () => {
      active = false;
      controller?.abort();
      if (timer) clearTimeout(timer);
    };
  }, [merge, markRequestFailed, markRequestSucceeded]);

  return null;
}
