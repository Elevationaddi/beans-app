"use client";
import type { Profile } from "@beans/contracts";
import { useAuth } from "@beans/web";
import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

type Membership = Profile["memberships"][number];

interface MerchantValue {
  memberships: Membership[];
  current: Membership | null;
  merchantId: string;
  role: Membership["role"] | null;
  isOwner: boolean;
  canManage: boolean;
  select: (merchantId: string) => void;
}

const MerchantContext = createContext<MerchantValue | null>(null);
const KEY = "cm.portal.merchant";

/** The business the signed-in person is working on. Authority still comes from the API. */
export function MerchantProvider({ children }: { children: ReactNode }) {
  const { profile } = useAuth();
  const memberships = useMemo(
    () => (profile?.memberships ?? []).filter((m) => m.role !== "barista"),
    [profile],
  );
  // Read once on the client; this provider renders only after sign-in has resolved.
  const [selected, setSelected] = useState<string | null>(() => {
    try {
      return typeof window === "undefined" ? null : window.localStorage.getItem(KEY);
    } catch {
      return null;
    }
  });
  const current = memberships.find((m) => m.merchantId === selected) ?? memberships[0] ?? null;
  const value: MerchantValue = {
    memberships,
    current,
    merchantId: current?.merchantId ?? "",
    role: current?.role ?? null,
    isOwner: current?.role === "owner",
    canManage: current?.role === "owner" || current?.role === "manager",
    select: (id) => {
      setSelected(id);
      try {
        window.localStorage.setItem(KEY, id);
      } catch {
        // Storage blocked: the choice lasts for this page only.
      }
    },
  };
  return <MerchantContext.Provider value={value}>{children}</MerchantContext.Provider>;
}

export function useMerchant(): MerchantValue {
  const value = useContext(MerchantContext);
  if (!value) throw new Error("useMerchant outside MerchantProvider");
  return value;
}
