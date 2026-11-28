"use client";
import { AuthGate, AuthProvider, useI18n } from "@beans/web";
import Link from "next/link";
import type { ReactNode } from "react";
import { tabletAuth } from "../../lib/config";

/**
 * Barista tablet (docs/05). A separate session from the portal, so a shared counter tablet
 * never carries an owner's sign-in. Staff sign in with their own account (D12).
 */
export default function TabletLayout({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  return (
    <AuthProvider config={tabletAuth}>
      <AuthGate
        surface="tablet"
        allowed={(p) => p.memberships.some((m) => m.role !== "analyst")}
        devFilter={(a) => a.kind === "staff" || a.kind === "business"}
        links={
          <p className="muted">
            <Link href="/dashboard">{t("tablet.openPortal")}</Link>
          </p>
        }
      >
        {children}
      </AuthGate>
    </AuthProvider>
  );
}
