"use client";

import {useEffect} from "react";
import type {ActivityResponse} from "@/data/types";
import {useActivity} from "@/state/activity-store";

const POLL_INTERVAL_MS = 5_000;
const REQUEST_TIMEOUT_MS = 9_000;

function isActivityResponse(value: unknown): value is ActivityResponse {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<ActivityResponse>;
  return candidate.chainId === 5042 && Array.isArray(candidate.transfers);
}

export function LiveActivity() {
  const merge = useActivity(state => state.mergeTransfers);
  const markRequestSucceeded = useActivity(state => state.markRequestSucceeded);
  const markRequestFailed = useActivity(state => state.markRequestFailed);

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | undefined;

    async function load() {
      controller = new AbortController();
      const timeout = setTimeout(() => controller?.abort(), REQUEST_TIMEOUT_MS);
      try {
        const response = await fetch("/api/activity", {cache: "no-store", signal: controller.signal});
        if (!response.ok) throw new Error(`Activity request failed (${response.status})`);
        const data: unknown = await response.json();
        if (!isActivityResponse(data)) throw new Error("Malformed Arc Mainnet activity response");
        if (active) {
          merge(data.transfers);
          markRequestSucceeded();
        }
      } catch {
        if (active) markRequestFailed();
      } finally {
        clearTimeout(timeout);
        if (active) timer = setTimeout(load, POLL_INTERVAL_MS);
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
