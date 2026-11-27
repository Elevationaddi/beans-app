/**
 * AED display from integer fils, without floating-point arithmetic (CLAUDE.md). The server
 * sends fils as decimal strings; 100 fils = 1 AED, always shown with two decimals.
 */
export function formatFils(fils: string | bigint, locale: "en" | "ar"): string {
  const value = typeof fils === "bigint" ? fils : BigInt(fils);
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const major = (abs / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const minor = (abs % 100n).toString().padStart(2, "0");
  const amount = `${negative ? "-" : ""}${major}.${minor}`;
  // Arabic currency label pending native review (docs/09); digits stay Western for clarity.
  return locale === "ar" ? `${amount} د.إ` : `AED ${amount}`;
}

export function sumFils(values: readonly string[]): string {
  return values.reduce((total, v) => total + BigInt(v), 0n).toString();
}
