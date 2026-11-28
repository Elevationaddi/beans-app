"use client";
import { BrandStyle, I18nProvider, ToastProvider } from "@beans/web";
import type { ReactNode } from "react";
import { dictionaries } from "../lib/i18n";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <I18nProvider dictionaries={dictionaries}>
      <BrandStyle />
      <ToastProvider>{children}</ToastProvider>
    </I18nProvider>
  );
}
