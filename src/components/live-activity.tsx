"use client";

import {useEffect} from "react";
import type {ActivityResponse} from "@/data/types";
import {useActivity} from "@/state/activity-store";

const POLL_INTERVAL_MS = 6_000;
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_RETRY_DELAY_MS = 20_000;
const BACKGROUND_POLL_MS = 30_000;

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
    let inFlight = false;

    function schedule(delay: number) {
      if (timer) clearTimeout(timer);
      timer = setTimeout(load, delay);
    }

    async function load() {
      if (!active || inFlight) return;
      if (document.hidden || !navigator.onLine) { schedule(BACKGROUND_POLL_MS); return; }
      inFlight = true;
      const startedAt = performance.now();
      controller = new AbortController();
      const timeout = setTimeout(() => controller?.abort(), REQUEST_TIMEOUT_MS);
      let failedResponse: ActivityResponse | undefined;
      try {
        const response = await fetch("/api/activity", {signal: controller.signal});
        const data: unknown = await response.json();
        if (!isActivityResponse(data)) throw new Error("Malformed Arc Mainnet activity response");
        if (!response.ok || data.status === "error") { failedResponse = data; throw new Error(`Activity request failed (${response.status})`); }
        if (active) {
          merge(data.events, data.windowReferenceTimestamp);
          consecutiveFailures = 0;
          markRequestSucceeded(data, Math.round(performance.now() - startedAt));
        }
      } catch {
        if (active && !document.hidden && navigator.onLine) {
          consecutiveFailures += 1;
          markRequestFailed(failedResponse);
        }
      } finally {
        inFlight = false;
        clearTimeout(timeout);
        if (active) {
          const retryDelay = consecutiveFailures === 0
            ? POLL_INTERVAL_MS
            : Math.min(POLL_INTERVAL_MS * 2 ** Math.min(consecutiveFailures - 1, 2), MAX_RETRY_DELAY_MS);
          schedule(document.hidden || !navigator.onLine ? BACKGROUND_POLL_MS : retryDelay + Math.floor(Math.random() * 800));
        }
      }
    }

    function resume() {
      if (!document.hidden && navigator.onLine && !inFlight) schedule(0);
    }
    document.addEventListener("visibilitychange", resume);
    window.addEventListener("online", resume);
    void load();
    return () => {
      active = false;
      document.removeEventListener("visibilitychange", resume);
      window.removeEventListener("online", resume);
      controller?.abort();
      if (timer) clearTimeout(timer);
    };
  }, [merge, markRequestFailed, markRequestSucceeded]);

  return null;
}
