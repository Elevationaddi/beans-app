"use client";
import { staffMemberResponseSchema } from "@beans/contracts";
import {
  ActionError,
  Banner,
  Button,
  Card,
  PageHeader,
  useAction,
  useApi,
  useAuth,
  useI18n,
} from "@beans/web";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";

function Accept() {
  const { t } = useI18n();
  const api = useApi();
  const { refreshProfile } = useAuth();
  const token = useSearchParams().get("token") ?? "";
  const [done, setDone] = useState(false);
  const accept = useAction(async () => {
    await api.post("/v1/merchant/invitations/accept", staffMemberResponseSchema, { token });
    await refreshProfile();
    setDone(true);
  });
  return (
    <>
      <PageHeader title={t("invite.title")} />
      <Card>
        {done ? (
          <Banner tone="success">
            {t("invite.done")} <Link href="/dashboard">{t("nav.dashboard")}</Link> ·{" "}
            <Link href="/tablet">{t("portal.openTablet")}</Link>
          </Banner>
        ) : (
          <>
            <p>{t("invite.body")}</p>
            <ActionError error={accept.error} />
            <Button
              onClick={() => void accept.run()}
              loading={accept.pending}
              disabled={token.length < 20}
              data-testid="accept-invite"
            >
              {t("invite.accept")}
            </Button>
          </>
        )}
      </Card>
    </>
  );
}

/** Staff accept an invitation with their own signed-in account (B07). */
export default function InvitePage() {
  return (
    <Suspense>
      <Accept />
    </Suspense>
  );
}
