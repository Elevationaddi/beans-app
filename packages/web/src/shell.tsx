"use client";
import type { Profile } from "@beans/contracts";
import { brand } from "@beans/ui";
import { useState, type ComponentType, type ReactNode } from "react";
import { useAuth } from "./auth";
import { Banner, LanguageToggle, Logo } from "./components";
import { useOnline } from "./hooks";
import { useI18n } from "./i18n";

export interface NavItem {
  href: string;
  label: string;
  active: boolean;
  testId?: string;
}

type LinkLike = ComponentType<{
  href: string;
  className?: string;
  children: ReactNode;
  "aria-current"?: "page";
  "data-testid"?: string;
  onClick?: () => void;
}>;

/** Responsive sidebar layout for the portal and the admin console (docs/09). */
export function Shell({
  surface,
  nav,
  Link,
  children,
  toolbar,
}: {
  surface: keyof typeof brand.surfaces;
  nav: NavItem[];
  Link: LinkLike;
  children: ReactNode;
  toolbar?: ReactNode;
}) {
  const { t } = useI18n();
  const { profile, signOut } = useAuth();
  const online = useOnline();
  const [open, setOpen] = useState(false);
  return (
    <div className="shell">
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <aside className={`sidebar${open ? " open" : ""}`} aria-label={t("common.menu")}>
        <div className="sidebar-head">
          <Logo surface={surface} />
        </div>
        <nav>
          <ul>
            {nav.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={item.active ? "nav-link active" : "nav-link"}
                  {...(item.active ? { "aria-current": "page" as const } : {})}
                  {...(item.testId ? { "data-testid": item.testId } : {})}
                  onClick={() => setOpen(false)}
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </aside>
      <div className="main-col">
        <header className="topbar">
          <button
            className="icon-btn menu-btn"
            aria-expanded={open}
            aria-label={t("common.menu")}
            onClick={() => setOpen((v) => !v)}
          >
            ☰
          </button>
          <div className="topbar-tools">{toolbar}</div>
          <LanguageToggle />
          <span className="user" data-testid="signed-in-user">
            {displayName(profile)}
          </span>
          <button className="btn btn-ghost" onClick={() => void signOut()} data-testid="sign-out">
            {t("common.signOut")}
          </button>
        </header>
        <Banner tone="info">{t("common.sandbox")}</Banner>
        {!online ? <Banner tone="warning">{t("common.offline")}</Banner> : null}
        <main id="main" className="content" tabIndex={-1}>
          {children}
        </main>
      </div>
    </div>
  );
}

export function displayName(profile: Profile | null): string {
  return profile?.displayName ?? profile?.email ?? profile?.phone ?? "";
}
