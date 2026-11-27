import { useCallback, useEffect, useRef, useState } from "react";
import { ApiFailure } from "./api";

export interface Remote<T> {
  data: T | null;
  loading: boolean;
  error: ApiFailure | null;
  /** The data shown is from an earlier successful load (the latest one failed). */
  stale: boolean;
  reload: () => void;
}

/**
 * Loads data for a screen with explicit loading, error, and stale/offline states (docs/02).
 * Keeps the last good data when a reload fails, and labels it stale instead of hiding it.
 */
export function useRemote<T>(load: () => Promise<T>, deps: readonly unknown[]): Remote<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiFailure | null>(null);
  const [tick, setTick] = useState(0);
  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    loadRef
      .current()
      .then((result) => {
        if (cancelled) return;
        setData(result);
        setError(null);
      })
      .catch((failure: unknown) => {
        if (cancelled) return;
        setError(
          failure instanceof ApiFailure
            ? failure
            : new ApiFailure("server", 0, "INTERNAL_ERROR", String(failure)),
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);

  const reload = useCallback(() => setTick((n) => n + 1), []);
  return { data, loading, error, stale: error !== null && data !== null, reload };
}
