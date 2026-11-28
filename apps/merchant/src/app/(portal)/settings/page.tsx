"use client";
import { privacyRequestResponseSchema, profileResponseSchema } from "@beans/contracts";
import {
  ActionError,
  Banner,
  Button,
  Card,
  ConfirmDialog,
  DefinitionList,
  PageHeader,
  SelectField,
  TextField,
  useAction,
  useAuth,
  useI18n,
  useToast,
} from "@beans/web";
import { useState } from "react";
import { useMerchant } from "../../../lib/merchant";

/**
 * B12: personal profile and language, password, the business memberships this account holds,
 * and an account deletion request (handled by platform support as a privacy request).
 */
export default function SettingsPage() {
  const { t, locale, setLocale } = useI18n();
  const auth = useAuth();
  const toast = useToast();
  const { memberships } = useMerchant();
  const profile = auth.profile;
  const [edited, setName] = useState<string | null>(null);
  const name = edited ?? profile?.displayName ?? "";
  const save = useAction(async () => {
    await auth.api.patch("/v1/me", profileResponseSchema, {
      displayName: name.trim() || null,
      locale,
    });
    await auth.refreshProfile();
    toast(t("common.saved"));
  });
  const [password, setPassword] = useState("");
  const changePassword = useAction(async () => {
    await auth.updatePassword(password);
    setPassword("");
    toast(t("settings.passwordChanged"));
  });
  const [deleting, setDeleting] = useState(false);
  const requestDeletion = useAction(async (reason: string) => {
    await auth.api.post("/v1/me/privacy-requests", privacyRequestResponseSchema, {
      kind: "deletion",
      ...(reason ? { message: reason } : {}),
    });
    setDeleting(false);
    toast(t("settings.deletionRequested"));
  });
  const isDev = auth.session?.source === "dev";
  return (
    <>
      <PageHeader title={t("settings.title")} />
      <div className="stack">
        <Card title={t("settings.profile")}>
          <TextField
            label={t("settings.displayName")}
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={80}
            error={save.error?.fieldErrors["displayName"]}
          />
          <SelectField
            label={t("common.language")}
            value={locale}
            onChange={(e) => setLocale(e.target.value as "en" | "ar")}
            options={[
              { value: "en", label: "English" },
              { value: "ar", label: "العربية" },
            ]}
          />
          <DefinitionList
            items={[
              [t("auth.email"), profile?.email ?? "—"],
              [t("settings.mfa"), profile?.mfaVerified ? t("common.yes") : t("common.no")],
            ]}
          />
          <ActionError error={save.error} />
          <Button onClick={() => void save.run()} loading={save.pending} data-testid="save-profile">
            {t("common.save")}
          </Button>
        </Card>
        <Card title={t("settings.password")}>
          {isDev || !auth.supabaseReady ? (
            <Banner tone="info">{t("settings.passwordDev")}</Banner>
          ) : (
            <>
              <TextField
                label={t("settings.newPassword")}
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                hint={t("auth.passwordHint")}
              />
              <ActionError error={changePassword.error} />
              <Button
                onClick={() => void changePassword.run()}
                disabled={password.length < 8}
                loading={changePassword.pending}
              >
                {t("settings.changePassword")}
              </Button>
            </>
          )}
        </Card>
        <Card title={t("settings.businesses")}>
          {memberships.length === 0 ? (
            <p className="muted">{t("settings.noBusinesses")}</p>
          ) : (
            <DefinitionList
              items={memberships.map((m) => [m.brandName, t(`role.${m.role}`)] as [string, string])}
            />
          )}
        </Card>
        <Card title={t("settings.deleteTitle")}>
          <p>{t("settings.deleteBody")}</p>
          <Button
            variant="destructive"
            onClick={() => setDeleting(true)}
            data-testid="request-deletion"
          >
            {t("settings.deleteAction")}
          </Button>
        </Card>
      </div>
      <ConfirmDialog
        open={deleting}
        title={t("settings.deleteTitle")}
        body={t("settings.deleteConfirm")}
        confirmLabel={t("settings.deleteAction")}
        destructive
        onConfirm={(reason) => void requestDeletion.run(reason)}
        onClose={() => setDeleting(false)}
        pending={requestDeletion.pending}
        error={requestDeletion.error}
      />
    </>
  );
}
