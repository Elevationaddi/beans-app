import { createContext, type ReactNode, useContext, useMemo } from "react";
import { ar } from "./ar";
import { en, type MessageKey } from "./en";

export type Locale = "en" | "ar";
export const dictionaries: Record<Locale, Record<MessageKey, string>> = { en, ar };

export function translate(
  locale: Locale,
  key: MessageKey,
  vars: Record<string, string | number> = {},
): string {
  return dictionaries[locale][key].replace(/\{(\w+)\}/g, (_, name: string) =>
    String(vars[name] ?? `{${name}}`),
  );
}

interface I18n {
  locale: Locale;
  rtl: boolean;
  t: (key: MessageKey, vars?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18n>({
  locale: "en",
  rtl: false,
  t: (k, v) => translate("en", k, v),
});

export function I18nProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  const value = useMemo<I18n>(
    () => ({ locale, rtl: locale === "ar", t: (key, vars) => translate(locale, key, vars) }),
    [locale],
  );
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export const useI18n = () => useContext(I18nContext);

/** Customer-facing text from the API: Arabic when available, English otherwise. */
export function localized(text: { en: string; ar?: string | undefined }, locale: Locale): string {
  return locale === "ar" && text.ar ? text.ar : text.en;
}

export type { MessageKey };
