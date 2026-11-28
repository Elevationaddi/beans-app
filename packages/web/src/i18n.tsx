"use client";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type Locale = "en" | "ar";
export type Dictionary = Record<string, string>;

interface I18nValue {
  locale: Locale;
  dir: "ltr" | "rtl";
  setLocale: (locale: Locale) => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18nValue | null>(null);
const STORAGE_KEY = "cm.locale";

function readStored(): Locale | null {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    return value === "ar" || value === "en" ? value : null;
  } catch {
    return null;
  }
}

/**
 * English and Arabic with right-to-left layout. Arabic dictionaries are drafts for layout
 * testing and are marked for native review (CLAUDE.md: no invented production translations).
 */
export function I18nProvider({
  dictionaries,
  children,
}: {
  dictionaries: Record<Locale, Dictionary>;
  children: ReactNode;
}) {
  const [locale, setLocaleState] = useState<Locale>("en");
  useEffect(() => {
    const stored = readStored();
    if (stored) setLocaleState(stored);
  }, []);
  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = locale === "ar" ? "rtl" : "ltr";
  }, [locale]);
  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Storage blocked (private mode): the choice lasts for this page only.
    }
  }, []);
  const t = useCallback(
    (key: string, vars?: Record<string, string | number>) => {
      const template = dictionaries[locale][key] ?? dictionaries.en[key] ?? key;
      return vars
        ? template.replace(/\{(\w+)\}/g, (_, name: string) => String(vars[name] ?? `{${name}}`))
        : template;
    },
    [dictionaries, locale],
  );
  const value = useMemo<I18nValue>(
    () => ({ locale, dir: locale === "ar" ? "rtl" : "ltr", setLocale, t }),
    [locale, setLocale, t],
  );
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const value = useContext(I18nContext);
  if (!value) throw new Error("useI18n outside I18nProvider");
  return value;
}

const DUBAI = "Asia/Dubai";

/** AED from integer fils, two decimals, in the reader's language. No float arithmetic on totals. */
export function formatFils(fils: string | number | bigint, locale: Locale): string {
  const value = BigInt(fils);
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const whole = abs / 100n;
  const cents = (abs % 100n).toString().padStart(2, "0");
  const number = new Intl.NumberFormat(locale === "ar" ? "ar-AE" : "en-AE", {
    useGrouping: true,
  }).format(whole);
  const decimal = locale === "ar" ? "٫" : ".";
  const digits =
    locale === "ar" ? cents.replace(/\d/g, (d) => "٠١٢٣٤٥٦٧٨٩"[Number(d)] ?? d) : cents;
  const amount = `${negative ? "-" : ""}${number}${decimal}${digits}`;
  return locale === "ar" ? `${amount} د.إ` : `AED ${amount}`;
}

export function formatDateTime(iso: string | null | undefined, locale: Locale): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat(locale === "ar" ? "ar-AE" : "en-AE", {
    timeZone: DUBAI,
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(iso));
}

export function formatTime(iso: string | null | undefined, locale: Locale): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat(locale === "ar" ? "ar-AE" : "en-AE", {
    timeZone: DUBAI,
    timeStyle: "short",
  }).format(new Date(iso));
}

export function formatDate(iso: string | null | undefined, locale: Locale): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat(locale === "ar" ? "ar-AE" : "en-AE", {
    timeZone: DUBAI,
    dateStyle: "medium",
  }).format(new Date(iso));
}

/** Today's date in Dubai as YYYY-MM-DD. */
export function dubaiToday(offsetDays = 0): string {
  const now = new Date(Date.now() + offsetDays * 86_400_000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: DUBAI }).format(now);
}
