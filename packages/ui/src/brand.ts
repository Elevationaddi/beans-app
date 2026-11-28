import { colors } from "./tokens.js";

/**
 * The single source of the product identity (D13, 2026-11-28). Every surface reads its name,
 * palette and fonts from here, so the final brand replaces this file and nothing else.
 *
 * "Coffee Marketplace" is a temporary working name. The Arabic name is a draft for layout
 * testing and needs native review before release.
 */
export const brand = {
  name: { en: "Coffee Marketplace", ar: "سوق القهوة" },
  tagline: {
    en: "Order ahead from specialty cafés near you",
    ar: "اطلب مسبقًا من مقاهي القهوة المختصة القريبة منك",
  },
  /** Two-letter monogram used where a logo would go until the real logo is supplied. */
  monogram: "CM",
  colors,
  fonts: {
    latin: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
    arabic: '"Noto Sans Arabic", "Segoe UI", Tahoma, sans-serif',
  },
  surfaces: {
    customer: { en: "Coffee Marketplace", ar: "سوق القهوة" },
    business: { en: "Business portal", ar: "بوابة الأعمال" },
    tablet: { en: "Branch tablet", ar: "جهاز الفرع" },
    admin: { en: "Admin console", ar: "لوحة الإدارة" },
  },
  supportEmailPlaceholder: "support@example.test",
} as const;

export type BrandLocale = keyof typeof brand.name;
