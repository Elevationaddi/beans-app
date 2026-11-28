"use client";
import type { Profile } from "@beans/contracts";
import { useAuth, type Tone } from "@beans/web";

export type AdminRole = Profile["adminRoles"][number];

/**
 * Screens of the console and the admin roles that may open each one. These mirror the API's
 * own role checks (packages/contracts routes); the API remains the authority and refuses
 * anything outside a role, so hiding a link is a convenience, not the control.
 * super_admin has no implicit access: it manages roles and settings only.
 */
export const SCREENS: { href: string; key: string; roles: AdminRole[] }[] = [
  {
    href: "/overview",
    key: "nav.overview",
    roles: ["operations", "finance_maker", "finance_checker", "analyst"],
  },
  { href: "/merchants", key: "nav.merchants", roles: ["operations", "super_admin"] },
  { href: "/customers", key: "nav.customers", roles: ["support", "operations", "security"] },
  {
    href: "/orders",
    key: "nav.orders",
    roles: ["operations", "support", "finance_maker", "finance_checker"],
  },
  { href: "/finance", key: "nav.finance", roles: ["finance_maker", "finance_checker"] },
  { href: "/support", key: "nav.support", roles: ["support", "operations"] },
  { href: "/privacy", key: "nav.privacy", roles: ["support", "security"] },
  { href: "/moderation", key: "nav.moderation", roles: ["operations", "marketing"] },
  { href: "/promotions", key: "nav.promotions", roles: ["marketing", "operations"] },
  { href: "/homepage", key: "nav.homepage", roles: ["marketing", "super_admin"] },
  { href: "/broadcast", key: "nav.broadcast", roles: ["marketing", "operations"] },
  {
    href: "/reports",
    key: "nav.reports",
    roles: ["operations", "finance_maker", "finance_checker", "analyst"],
  },
  {
    href: "/settings",
    key: "nav.settings",
    roles: ["operations", "security", "marketing", "super_admin"],
  },
  { href: "/admins", key: "nav.admins", roles: ["super_admin", "security"] },
  { href: "/audit", key: "nav.audit", roles: ["security"] },
];

export function hasAny(profile: Profile | null, roles: readonly AdminRole[]): boolean {
  return Boolean(profile?.adminRoles.some((r) => roles.includes(r)));
}

/** The signed-in admin's roles, with a helper for "may do this". */
export function useRoles() {
  const { profile } = useAuth();
  return {
    roles: profile?.adminRoles ?? [],
    can: (...roles: AdminRole[]) => hasAny(profile, roles),
  };
}

export const orderTone: Record<string, Tone> = {
  pending_payment: "neutral",
  payment_failed: "error",
  received: "warning",
  accepted: "info",
  preparing: "info",
  ready: "success",
  completed: "success",
  rejected: "error",
  cancelled: "neutral",
};

export const statusTone: Record<string, Tone> = {
  active: "success",
  approved: "success",
  suspended: "error",
  deleted: "neutral",
  draft: "neutral",
  submitted: "warning",
  review: "info",
  rejected: "error",
  open: "warning",
  pending: "info",
  resolved: "success",
  closed: "neutral",
  requested: "warning",
  pending_approval: "warning",
  submitted_refund: "info",
  succeeded: "success",
  paid: "success",
  failed: "error",
  captured: "success",
  evidence_submitted: "info",
  won: "success",
  lost: "error",
  declined: "neutral",
};

export const shortId = (id: string | null | undefined) => (id ? id.slice(0, 8) : "—");

export type Preset = "today" | "7d" | "30d";

/** Period for a preset, computed when the request is made (not during render). */
export function rangeFor(preset: Preset): { from: string; to: string } {
  const to = new Date();
  if (preset === "today") {
    // Start of today in Dubai (UTC+4, no daylight saving).
    const dubai = new Date(to.getTime() + 4 * 3600_000);
    dubai.setUTCHours(0, 0, 0, 0);
    return { from: new Date(dubai.getTime() - 4 * 3600_000).toISOString(), to: to.toISOString() };
  }
  const from = new Date(to.getTime() - (preset === "7d" ? 7 : 30) * 86_400_000);
  return { from: from.toISOString(), to: to.toISOString() };
}

/** Text in the viewer's language, falling back to English when there is no Arabic yet. */
export function localized(text: { en: string; ar?: string | undefined } | null, locale: string) {
  if (!text) return "";
  return locale === "ar" && text.ar ? text.ar : text.en;
}

/**
 * "12.5" or "12.50" AED to fils as a string, without floating point (CLAUDE.md: integer fils).
 * Returns null for anything that is not a positive amount with at most two decimals.
 */
export function aedToFils(input: string): string | null {
  const match = /^(\d{1,7})(?:\.(\d{1,2}))?$/.exec(input.trim());
  if (!match) return null;
  const fils = BigInt(match[1] ?? "0") * 100n + BigInt((match[2] ?? "").padEnd(2, "0") || "0");
  return fils > 0n ? fils.toString() : null;
}

/** Fils to an editable "12.50" string. */
export function filsToAed(fils: string): string {
  const v = BigInt(fils);
  return `${v / 100n}.${(v % 100n).toString().padStart(2, "0")}`;
}
