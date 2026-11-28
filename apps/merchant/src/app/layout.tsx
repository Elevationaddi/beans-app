import type { Metadata, Viewport } from "next";
import "@beans/web/styles.css";
import "./portal.css";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: "Business portal · Coffee Marketplace (sandbox)",
  description:
    "Manage your café on Coffee Marketplace. Sandbox build: test data and payments only.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: LayoutProps<"/">) {
  // Language and direction are set on <html> by the I18nProvider once the saved choice loads.
  return (
    <html lang="en" dir="ltr">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
