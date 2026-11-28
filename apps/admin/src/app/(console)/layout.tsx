"use client";
import { AuthGate, AuthProvider, Shell, useI18n, type NavItem } from "@beans/web";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { SCREENS, useRoles } from "../../lib/admin";
import { adminAuth } from "../../lib/config";

function ConsoleShell({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const pathname = usePathname();
  const { can, roles } = useRoles();
  const nav: NavItem[] = SCREENS.filter((s) => can(...s.roles)).map((s) => ({
    href: s.href,
    label: t(s.key),
    active: pathname === s.href || pathname.startsWith(`${s.href}/`),
    testId: `nav-${s.href.slice(1)}`,
  }));
  return (
    <Shell
      surface="admin"
      nav={nav}
      Link={Link}
      toolbar={
        <span className="muted small" data-testid="admin-roles">
          {roles.map((r) => t(`role.${r}`)).join(" · ")}
        </span>
      }
    >
      {children}
    </Shell>
  );
}

/**
 * Every console page needs an admin role and a session with two-step verification (aal2).
 * The API enforces both on every admin route as well.
 */
export default function ConsoleLayout({ children }: { children: ReactNode }) {
  return (
    <AuthProvider config={adminAuth}>
      <AuthGate
        surface="admin"
        requireMfa
        allowed={(p) => p.adminRoles.length > 0}
        devFilter={(a) => a.adminRoles.length > 0}
      >
        <ConsoleShell>{children}</ConsoleShell>
      </AuthGate>
    </AuthProvider>
  );
}
