"use client";
import { AuthGate, AuthProvider, Shell, useI18n, type NavItem } from "@beans/web";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { portalAuth } from "../../lib/config";
import { MerchantProvider, useMerchant } from "../../lib/merchant";

const NAV: { href: string; key: string; roles: ("owner" | "manager" | "analyst" | "none")[] }[] = [
  { href: "/dashboard", key: "nav.dashboard", roles: ["owner", "manager", "analyst"] },
  { href: "/onboarding", key: "nav.onboarding", roles: ["owner", "none"] },
  { href: "/orders", key: "nav.orders", roles: ["owner", "manager"] },
  { href: "/branches", key: "nav.branches", roles: ["owner", "manager"] },
  { href: "/menu", key: "nav.menu", roles: ["owner", "manager"] },
  { href: "/availability", key: "nav.availability", roles: ["owner", "manager"] },
  { href: "/staff", key: "nav.staff", roles: ["owner"] },
  { href: "/loyalty", key: "nav.marketing", roles: ["owner", "manager"] },
  { href: "/finance", key: "nav.finance", roles: ["owner", "analyst"] },
  { href: "/analytics", key: "nav.analytics", roles: ["owner", "manager", "analyst"] },
  { href: "/support", key: "nav.support", roles: ["owner", "manager"] },
  { href: "/settings", key: "nav.settings", roles: ["owner", "manager", "analyst", "none"] },
];

function PortalShell({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const pathname = usePathname();
  const { role, memberships, merchantId, select } = useMerchant();
  const effective = role ?? "none";
  const nav: NavItem[] = NAV.filter((n) => n.roles.includes(effective as never)).map((n) => ({
    href: n.href,
    label: t(n.key),
    active: pathname === n.href || pathname.startsWith(`${n.href}/`),
    testId: `nav-${n.href.slice(1)}`,
  }));
  return (
    <Shell
      surface="business"
      nav={nav}
      Link={Link}
      toolbar={
        memberships.length > 1 ? (
          <label className="row small">
            <span>{t("portal.business")}</span>
            <select
              className="input"
              value={merchantId}
              onChange={(e) => select(e.target.value)}
              data-testid="merchant-switch"
            >
              {memberships.map((m) => (
                <option key={m.merchantId} value={m.merchantId}>
                  {m.brandName}
                </option>
              ))}
            </select>
          </label>
        ) : memberships[0] ? (
          <strong>{memberships[0].brandName}</strong>
        ) : null
      }
    >
      {children}
    </Shell>
  );
}

export default function PortalLayout({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  return (
    <AuthProvider config={portalAuth}>
      <AuthGate
        surface="business"
        allowed={() => true}
        devFilter={(a) =>
          a.kind === "business" ||
          (a.kind === "staff" && !a.membershipRoles.includes("barista")) ||
          a.kind === "customer"
        }
        links={
          <p className="muted">
            {t("portal.newBusiness")} <Link href="/account/sign-up">{t("auth.signUp")}</Link> ·{" "}
            <Link href="/tablet">{t("portal.openTablet")}</Link>
          </p>
        }
      >
        <MerchantProvider>
          <PortalShell>{children}</PortalShell>
        </MerchantProvider>
      </AuthGate>
    </AuthProvider>
  );
}
