/**
 * Working design tokens from docs/09-design-system.md.
 * The brand (name, logo, palette) is decision D13 and is NOT approved yet, so these
 * values may change. Check contrast per component; never rely on colour alone.
 */
export const colors = {
  background: "#FAF7F2",
  surface: "#FFFFFF",
  ink: "#241C18",
  primary: "#623F30",
  accent: "#B77954",
  success: "#237A50",
  warning: "#946200",
  error: "#B42318",
  border: "#E2DAD2",
} as const;

/** 4/8 spacing scale, in px (web) or density-independent points (mobile). */
export const space = {
  1: 4,
  2: 8,
  3: 12,
  4: 16,
  6: 24,
  8: 32,
  12: 48,
} as const;

export const radius = { md: 12 } as const;

export const typography = {
  size: { caption: 12, secondary: 14, body: 16, section: 20, headline: 28 },
  weight: { regular: "400", medium: "500", semibold: "600", bold: "700" },
} as const;

/** Minimum touch target: 44pt on iOS, 48dp on Android where appropriate. */
export const touchTarget = { ios: 44, android: 48 } as const;
