/**
 * The four user-facing surfaces. Titles are neutral working names until the brand
 * decision (D13 in docs/00-decisions.md) is approved. Not production copy.
 */
export const APP_SURFACES = {
  mobile: { title: "Coffee Marketplace" },
  merchant: { title: "Merchant portal" },
  tablet: { title: "Branch tablet" },
  admin: { title: "Admin console" },
} as const;

export type AppSurface = keyof typeof APP_SURFACES;
