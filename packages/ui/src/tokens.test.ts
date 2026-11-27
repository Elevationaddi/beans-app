import { describe, expect, it } from "vitest";
import { colors } from "./tokens.js";

/** WCAG 2.x relative luminance and contrast ratio. */
function luminance(hex: string): number {
  const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r, g, b] = channels.map((c) =>
    c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4,
  ) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

describe("colour tokens", () => {
  // WCAG 2.2 AA: 4.5:1 for normal text.
  it.each(["ink", "primary", "success", "warning", "error"] as const)(
    "%s text meets AA contrast on background and surface",
    (token) => {
      expect(contrast(colors[token], colors.background)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(colors[token], colors.surface)).toBeGreaterThanOrEqual(4.5);
    },
  );
});
