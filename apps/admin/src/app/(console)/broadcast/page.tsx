"use client";
import { broadcastResponseSchema } from "@beans/contracts";
import {
  ActionError,
  Banner,
  Button,
  Card,
  PageHeader,
  SelectField,
  TextArea,
  TextField,
  useAction,
  useApi,
  useI18n,
  useToast,
} from "@beans/web";
import { useState } from "react";
import { useRoles } from "../../../lib/admin";
import { NoAccess } from "../../../lib/ui";

type Audience = "customers" | "merchant_owners" | "all_staff";

/**
 * In-app announcements to an audience's inbox. No SMS, email or push is sent (CLAUDE.md: no
 * real notifications without approval). Each broadcast is audited with its reason.
 */
export default function BroadcastPage() {
  const { t } = useI18n();
  const api = useApi();
  const toast = useToast();
  const { can } = useRoles();
  const [audience, setAudience] = useState<Audience>("customers");
  const [titleEn, setTitleEn] = useState("");
  const [titleAr, setTitleAr] = useState("");
  const [bodyEn, setBodyEn] = useState("");
  const [bodyAr, setBodyAr] = useState("");
  const [reason, setReason] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [sent, setSent] = useState<number | null>(null);
  const send = useAction(async () => {
    const result = await api.post("/v1/admin/notifications/broadcast", broadcastResponseSchema, {
      audience,
      title: { en: titleEn.trim(), ...(titleAr.trim() ? { ar: titleAr.trim() } : {}) },
      body: { en: bodyEn.trim(), ...(bodyAr.trim() ? { ar: bodyAr.trim() } : {}) },
      reason: reason.trim(),
    });
    setSent(result.data.recipients);
    setConfirming(false);
    setTitleEn("");
    setTitleAr("");
    setBodyEn("");
    setBodyAr("");
    setReason("");
    toast(t("broadcast.sent", { count: result.data.recipients }));
  });
  if (!can("marketing", "operations")) return <NoAccess />;
  const ready = titleEn.trim() && bodyEn.trim() && reason.trim().length >= 3;
  return (
    <>
      <PageHeader title={t("broadcast.title")} subtitle={t("broadcast.subtitle")} />
      <Banner tone="info">{t("broadcast.inAppOnly")}</Banner>
      {sent !== null ? (
        <Banner tone="success">{t("broadcast.sent", { count: sent })}</Banner>
      ) : null}
      <Card>
        <SelectField
          label={t("broadcast.audience")}
          value={audience}
          onChange={(e) => setAudience(e.target.value as Audience)}
          options={(["customers", "merchant_owners", "all_staff"] as Audience[]).map((a) => ({
            value: a,
            label: t(`audience.${a}`),
          }))}
        />
        <div className="grid-2">
          <TextField
            label={t("broadcast.titleEn")}
            value={titleEn}
            maxLength={200}
            onChange={(e) => setTitleEn(e.target.value)}
            data-testid="broadcast-title-en"
          />
          <TextField
            label={t("broadcast.titleAr")}
            hint={t("common.arabicReview")}
            dir="rtl"
            lang="ar"
            value={titleAr}
            maxLength={200}
            onChange={(e) => setTitleAr(e.target.value)}
          />
          <TextArea
            label={t("broadcast.bodyEn")}
            value={bodyEn}
            maxLength={1000}
            onChange={(e) => setBodyEn(e.target.value)}
            data-testid="broadcast-body-en"
          />
          <TextArea
            label={t("broadcast.bodyAr")}
            hint={t("common.arabicReview")}
            dir="rtl"
            lang="ar"
            value={bodyAr}
            maxLength={1000}
            onChange={(e) => setBodyAr(e.target.value)}
          />
        </div>
        <TextField
          label={t("common.reason")}
          value={reason}
          maxLength={500}
          onChange={(e) => setReason(e.target.value)}
          data-testid="broadcast-reason"
        />
        {confirming ? (
          <Banner tone="warning">
            {t("broadcast.confirm", { audience: t(`audience.${audience}`) })}{" "}
            <span className="row">
              <Button
                loading={send.pending}
                onClick={() => void send.run()}
                data-testid="broadcast-confirm"
              >
                {t("broadcast.send")}
              </Button>
              <Button variant="secondary" onClick={() => setConfirming(false)}>
                {t("common.cancel")}
              </Button>
            </span>
          </Banner>
        ) : (
          <Button
            disabled={!ready}
            onClick={() => setConfirming(true)}
            data-testid="broadcast-send"
          >
            {t("broadcast.send")}
          </Button>
        )}
        <ActionError error={send.error} />
      </Card>
    </>
  );
}
