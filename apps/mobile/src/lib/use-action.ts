import { useCallback, useRef, useState } from "react";
import { ApiFailure } from "./api";

/** Runs one action at a time (no double submit) and keeps its pending state and failure. */
export function useAction<A extends unknown[], R>(action: (...args: A) => Promise<R>) {
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<ApiFailure | Error | null>(null);
  const busy = useRef(false);
  const run = useCallback(
    async (...args: A): Promise<R | undefined> => {
      if (busy.current) return undefined;
      busy.current = true;
      setPending(true);
      setFailure(null);
      try {
        return await action(...args);
      } catch (error) {
        setFailure(error instanceof Error ? error : new Error(String(error)));
        return undefined;
      } finally {
        busy.current = false;
        setPending(false);
      }
    },
    [action],
  );
  return { run, pending, failure };
}

export { ApiFailure };
