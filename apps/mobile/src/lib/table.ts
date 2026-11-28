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

const TOKEN = /^t1\.[A-Za-z0-9_-]{4,64}\.[1-9]\d{0,8}\.[A-Za-z0-9_-]{8,128}$/;

/**
 * The table code inside a scanned QR: either the printed link (`…?table=<code>`) or the bare
 * code. The link is never opened; only its code is taken and then checked by the server, so a
 * look-alike QR pointing elsewhere cannot send the customer to another site. Anything else
 * (another app's QR, a payment code, plain text) returns null.
 */
export function tableTokenFromScan(data: string): string | null {
  const text = data.trim();
  if (TOKEN.test(text)) return text;
  try {
    const url = new URL(text);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    const token = url.searchParams.get("table");
    return token && TOKEN.test(token) ? token : null;
  } catch {
    return null;
  }
}
