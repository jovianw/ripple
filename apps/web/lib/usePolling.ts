"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * The project's one polling primitive. Serverless functions cannot hold a
 * change stream open, so every live view polls; this keeps that decision in a
 * single place rather than repeated per page.
 *
 * The fetch is kicked off from a timer rather than called in the effect body,
 * so no state is set synchronously during an effect.
 */
export function usePolling<T>(
  fetcher: () => Promise<T>,
  intervalMs: number,
): { data: T | null; error: string | null; paused: boolean; togglePause: () => void } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);

  const pausedRef = useRef(false);
  // Kept in a ref so changing the fetcher identity does not restart the timer.
  // Synced in an effect rather than during render — writing a ref while
  // rendering is not safe under concurrent rendering.
  const fetcherRef = useRef(fetcher);
  useEffect(() => {
    fetcherRef.current = fetcher;
  }, [fetcher]);

  const tick = useCallback(async () => {
    if (pausedRef.current) return;
    try {
      const next = await fetcherRef.current();
      setData(next);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "poll failed");
    }
  }, []);

  useEffect(() => {
    const first = setTimeout(tick, 0);
    const timer = setInterval(tick, intervalMs);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [tick, intervalMs]);

  const togglePause = useCallback(() => {
    pausedRef.current = !pausedRef.current;
    setPaused(pausedRef.current);
  }, []);

  return { data, error, paused, togglePause };
}

/** Small helper: fetch JSON, tolerating a failed response body. */
export async function getJson<T>(url: string): Promise<T | null> {
  const res = await fetch(url, { cache: "no-store" });
  return (await res.json().catch(() => null)) as T | null;
}
