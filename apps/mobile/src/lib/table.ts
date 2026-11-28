import { Platform } from "react-native";
import { useSyncExternalStore } from "react";

/**
 * The dine-in table the customer scanned, kept in memory for this visit only. The token is the
 * signed code from the QR; the server checks it again on every quote (never a client table ID).
 */
export interface ChosenTable {
  token: string;
  branchId: string;
  label: string;
}

let current: ChosenTable | null = null;
const listeners = new Set<() => void>();

export function setTable(table: ChosenTable | null) {
  current = table;
  for (const listener of listeners) listener();
}

export function useTable(): ChosenTable | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => current,
    () => current,
  );
}

let linkRead = false;

/** On the web, a printed QR opens the app with ?table=<token>. Read once, then drop it. */
export function tableTokenFromLink(): string | null {
  if (linkRead || Platform.OS !== "web" || typeof window === "undefined") return null;
  linkRead = true;
  try {
    const url = new URL(window.location.href);
    const token = url.searchParams.get("table");
    if (!token) return null;
    url.searchParams.delete("table");
    window.history.replaceState(null, "", url.toString());
    return token;
  } catch {
    return null;
  }
}
