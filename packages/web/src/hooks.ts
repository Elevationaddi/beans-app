"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "./api";

export interface QueryState<T> {
  data: T | undefined;
  error: ApiError | null;
  loading: boolean;
  /** True when showing older data because the latest refresh failed. */
  stale: boolean;
  reload: () => void;
}

function asApiError(error: unknown): ApiError {
  return error instanceof ApiError
    ? error
    : new ApiError(0, "INTERNAL_ERROR", (error as Error)?.message ?? "Something went wrong");
}

/** Loads data when `deps` change; keeps the last good data (marked stale) if a refresh fails. */
export function useQuery<T>(
  load: (signal: AbortSignal) => Promise<T>,
  deps: unknown[],
  options: { enabled?: boolean; pollMs?: number } = {},
): QueryState<T> {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(options.enabled !== false);
  const [tick, setTick] = useState(0);
  const loadRef = useRef(load);
  loadRef.current = load;
  const enabled = options.enabled !== false;

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    loadRef
      .current(controller.signal)
      .then((value) => {
        if (controller.signal.aborted) return;
        setData(value);
        setError(null);
      })
      .catch((e: unknown) => {
        if (controller.signal.aborted || (e as Error)?.name === "AbortError") return;
        setError(asApiError(e));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick, enabled]);

  useEffect(() => {
    if (!options.pollMs || !enabled) return;
    const timer = window.setInterval(() => setTick((n) => n + 1), options.pollMs);
    return () => window.clearInterval(timer);
  }, [options.pollMs, enabled]);

  const reload = useCallback(() => setTick((n) => n + 1), []);
  return { data, error, loading, stale: Boolean(error && data !== undefined), reload };
}

export interface Page<T> {
  data: T[];
  meta: { nextCursor: string | null };
}

/** Cursor-paginated list with "load more". Resets when `deps` change. */
export function usePaged<T>(
  load: (cursor: string | undefined, signal: AbortSignal) => Promise<Page<T>>,
  deps: unknown[],
) {
  const [items, setItems] = useState<T[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    loadRef
      .current(undefined, controller.signal)
      .then((page) => {
        if (controller.signal.aborted) return;
        setItems(page.data);
        setCursor(page.meta.nextCursor);
        setError(null);
      })
      .catch((e: unknown) => {
        if (!controller.signal.aborted && (e as Error)?.name !== "AbortError")
          setError(asApiError(e));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);

  const more = useCallback(async () => {
    if (!cursor) return;
    setLoading(true);
    try {
      const page = await loadRef.current(cursor, new AbortController().signal);
      setItems((prev) => [...prev, ...page.data]);
      setCursor(page.meta.nextCursor);
    } catch (e) {
      setError(asApiError(e));
    } finally {
      setLoading(false);
    }
  }, [cursor]);

  return {
    items,
    error,
    loading,
    hasMore: Boolean(cursor),
    more,
    reload: useCallback(() => setTick((n) => n + 1), []),
  };
}

/** Runs one action at a time (no double submit), exposing its pending state and error. */
export function useAction<A extends unknown[], R>(action: (...args: A) => Promise<R>) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const busy = useRef(false);
  const run = useCallback(
    async (...args: A): Promise<R | undefined> => {
      if (busy.current) return undefined;
      busy.current = true;
      setPending(true);
      setError(null);
      try {
        return await action(...args);
      } catch (e) {
        setError(asApiError(e));
        return undefined;
      } finally {
        busy.current = false;
        setPending(false);
      }
    },
    [action],
  );
  return { run, pending, error, clearError: useCallback(() => setError(null), []) };
}

/** Online/offline indicator from the browser. */
export function useOnline(): boolean {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    setOnline(navigator.onLine);
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);
  return online;
}
