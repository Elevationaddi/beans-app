import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Admin console (development)",
  description: "Coffee marketplace admin console. Development build, no features enabled.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  // Locale and direction become dynamic once English/Arabic support lands (phase 5+).
  return (
    <html lang="en" dir="ltr">
      <body>{children}</body>
    </html>
  );
}
