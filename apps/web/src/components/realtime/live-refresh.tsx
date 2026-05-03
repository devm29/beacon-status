"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { useRealtimeEvent } from "./realtime-provider";

const MIN_INTERVAL_MS = 1_500;

/** Re-renders server components when something an operator cares about changes. */
export function LiveRefresh({ periodicMs = 60_000 }: { periodicMs?: number }) {
  const router = useRouter();
  const last = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = () => {
    if (timer.current) return;
    const wait = Math.max(0, last.current + MIN_INTERVAL_MS - Date.now());
    timer.current = setTimeout(() => {
      timer.current = null;
      last.current = Date.now();
      router.refresh();
    }, wait);
  };

  useRealtimeEvent((event) => {
    if (event.type !== "check.result") refresh();
  });

  useEffect(() => {
    const interval = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, periodicMs);
    return () => {
      clearInterval(interval);
      if (timer.current) clearTimeout(timer.current);
    };
  }, [router, periodicMs]);

  return null;
}
