"use client";
import { merchantBranchListResponseSchema, type MerchantBranch } from "@beans/contracts";
import { useApi, useQuery, type Tone } from "@beans/web";
import { useMerchant } from "./merchant";

/** Branches of the current business the caller can see (owners: all; managers: assigned). */
export function useBranches() {
  const api = useApi();
  const { merchantId } = useMerchant();
  return useQuery<MerchantBranch[]>(
    async (signal) =>
      (
        await api.get(
          "/v1/merchant/branches",
          merchantBranchListResponseSchema,
          { merchantId, limit: 100 },
          signal,
        )
      ).data,
    [merchantId],
    { enabled: Boolean(merchantId) },
  );
}

export function branchName(branch: Pick<MerchantBranch, "nameEn" | "nameAr">, locale: string) {
  return locale === "ar" && branch.nameAr ? branch.nameAr : branch.nameEn;
}

export const orderTone: Record<string, Tone> = {
  pending_payment: "warning",
  received: "info",
  accepted: "info",
  preparing: "warning",
  ready: "success",
  completed: "success",
  rejected: "error",
  cancelled: "error",
  expired: "neutral",
  payment_failed: "error",
};

/** Integer fils from an AED amount typed by a person ("12.5" → "1250"). Null when invalid. */
export function aedToFils(input: string): string | null {
  const m = input.trim().match(/^(\d{1,9})(?:[.,](\d{1,2}))?$/);
  if (!m) return null;
  const cents = (m[2] ?? "").padEnd(2, "0");
  return String(BigInt(m[1]!) * 100n + BigInt(cents));
}

export function filsToAedInput(fils: string): string {
  const v = BigInt(fils);
  return `${v / 100n}.${(v % 100n).toString().padStart(2, "0")}`;
}

/** ISO range for "today", "7 days" or "30 days" ending now, in UTC instants. */
export function rangeFor(preset: "today" | "7d" | "30d"): { from: string; to: string } {
  const to = new Date();
  const from = new Date(to);
  if (preset === "today") {
    // Start of today in Dubai (UTC+4, no daylight saving).
    const dubai = new Date(to.getTime() + 4 * 3600_000);
    dubai.setUTCHours(0, 0, 0, 0);
    return { from: new Date(dubai.getTime() - 4 * 3600_000).toISOString(), to: to.toISOString() };
  }
  from.setTime(to.getTime() - (preset === "7d" ? 7 : 30) * 86_400_000);
  return { from: from.toISOString(), to: to.toISOString() };
}
