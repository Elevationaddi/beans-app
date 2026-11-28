"use client";
import { AccountScreen, AuthProvider } from "@beans/web";
import { notFound, useParams } from "next/navigation";
import { portalAuth } from "../../../lib/config";

/** Business sign-up, password reset request and new password (after the emailed link). */
export default function AccountPage() {
  const { mode } = useParams<{ mode: string }>();
  if (mode !== "sign-up" && mode !== "reset" && mode !== "new-password") notFound();
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  return (
    <AuthProvider config={portalAuth}>
      <AccountScreen
        surface="business"
        mode={mode}
        redirectTo={mode === "reset" ? `${origin}/account/new-password` : `${origin}/onboarding`}
      />
    </AuthProvider>
  );
}
