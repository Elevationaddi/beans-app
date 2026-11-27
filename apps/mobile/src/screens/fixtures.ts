import type { BranchMenu, PublicBranchCard, PublicBranchDetail } from "@beans/contracts";

export const BRANCH_A = "11111111-1111-4111-8111-111111111111";
export const BRANCH_B = "22222222-2222-4222-8222-222222222222";
export const MERCHANT = "33333333-3333-4333-8333-333333333333";
export const LATTE = "44444444-4444-4444-8444-444444444444";
export const SIZE = "55555555-5555-4555-8555-555555555555";
export const SMALL = "66666666-6666-4666-8666-666666666666";
export const LARGE = "77777777-7777-4777-8777-777777777777";

export function card(id: string, overrides: Partial<PublicBranchCard> = {}): PublicBranchCard {
  return {
    id,
    merchantId: MERCHANT,
    brandName: "Test Roasters",
    names: { en: `Branch ${id.slice(0, 1)}`, ar: "فرع" },
    address: "Corniche Road",
    city: "abu_dhabi",
    lat: null,
    lng: null,
    modes: ["in_store", "curbside"],
    availability: "open",
    distanceMeters: null,
    ...overrides,
  };
}

export function detail(id: string): PublicBranchDetail {
  return {
    ...card(id),
    phone: null,
    timezone: "Asia/Dubai",
    hours: [{ weekday: 1, opens: "07:00", closes: "22:00" }],
    exceptions: [],
    siblings: [],
  };
}

export function menu(branchId: string): BranchMenu {
  return {
    branchId,
    currency: "AED",
    version: "v1",
    categories: [
      {
        id: "88888888-8888-4888-8888-888888888888",
        names: { en: "Coffee" },
        products: [
          {
            id: LATTE,
            names: { en: "Latte" },
            descriptions: {},
            priceFils: "1700",
            allergens: ["milk"],
            available: true,
            groups: [
              {
                id: SIZE,
                names: { en: "Size" },
                minCount: 1,
                maxCount: 1,
                options: [
                  { id: SMALL, names: { en: "Small" }, deltaFils: "0", available: true },
                  { id: LARGE, names: { en: "Large" }, deltaFils: "300", available: true },
                ],
              },
            ],
          },
        ],
      },
    ],
  };
}

/** API handlers for a branch: details, menu and server pricing (Large adds 300 fils). */
export function branchHandlers(branchId: string) {
  return {
    [`GET /v1/branches/${branchId}`]: () => ({ body: { data: detail(branchId) } }),
    [`GET /v1/branches/${branchId}/menu`]: () => ({ body: { data: menu(branchId) } }),
    [`POST /v1/branches/${branchId}/items/price`]: (req: { body: unknown }) => {
      const body = req.body as { optionIds: string[]; quantity: number; productId: string };
      const unit = 1700 + (body.optionIds.includes(LARGE) ? 300 : 0);
      return {
        body: {
          data: {
            ...body,
            unitFils: String(unit),
            lineFils: String(unit * body.quantity),
            menuVersion: "v1",
          },
        },
      };
    },
  };
}
