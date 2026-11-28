"use client";
import {
  MAX_DOCUMENT_BYTES,
  merchantApplicationListResponseSchema,
  merchantApplicationResponseSchema,
  uploadResponseSchema,
  uploadTicketResponseSchema,
  type MerchantApplication,
} from "@beans/contracts";
import {
  ActionError,
  Banner,
  Button,
  Card,
  DefinitionList,
  PageHeader,
  QueryView,
  SelectField,
  StatusChip,
  TextField,
  formatDateTime,
  useAction,
  useApi,
  useAuth,
  useI18n,
  useQuery,
  useToast,
  type Tone,
} from "@beans/web";
import { useState, type FormEvent } from "react";

const statusTone: Record<string, Tone> = {
  draft: "neutral",
  submitted: "info",
  review: "info",
  approved: "success",
  rejected: "error",
  suspended: "error",
};

/** B01: apply, upload documents, submit, follow verification status. */
export default function OnboardingPage() {
  const { t } = useI18n();
  const api = useApi();
  const [tick, setTick] = useState(0);
  const query = useQuery(
    async (signal) =>
      (
        await api.get(
          "/v1/merchant/applications",
          merchantApplicationListResponseSchema,
          { limit: 20 },
          signal,
        )
      ).data,
    [tick],
  );
  const reload = () => setTick((n) => n + 1);
  return (
    <>
      <PageHeader title={t("onboarding.title")} subtitle={t("onboarding.subtitle")} />
      <QueryView query={query}>
        {(apps) =>
          apps.length === 0 ? (
            <ApplicationForm onSaved={reload} />
          ) : (
            <div className="stack">
              {apps.map((a) => (
                <Application key={a.id} app={a} onChanged={reload} />
              ))}
            </div>
          )
        }
      </QueryView>
    </>
  );
}

function ApplicationForm({ app, onSaved }: { app?: MerchantApplication; onSaved: () => void }) {
  const { t } = useI18n();
  const api = useApi();
  const { profile } = useAuth();
  const toast = useToast();
  const [form, setForm] = useState({
    legalName: app?.legalName ?? "",
    brandName: app?.brandName ?? "",
    licenseNumber: app?.licenseNumber ?? "",
    name: app?.contact.name ?? profile?.displayName ?? "",
    email: app?.contact.email ?? profile?.email ?? "",
    phone: app?.contact.phone ?? "",
  });
  const save = useAction(async (e: FormEvent) => {
    e.preventDefault();
    const body = {
      legalName: form.legalName,
      brandName: form.brandName,
      licenseNumber: form.licenseNumber,
      contact: { name: form.name, email: form.email, phone: form.phone },
    };
    if (app)
      await api.patch(
        `/v1/merchant/applications/${app.id}`,
        merchantApplicationResponseSchema,
        body,
      );
    else await api.post("/v1/merchant/applications", merchantApplicationResponseSchema, body);
    toast(t("common.saved"));
    onSaved();
  });
  const fe = save.error?.fieldErrors ?? {};
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm({ ...form, [k]: e.target.value });
  return (
    <Card title={app ? t("onboarding.edit") : t("onboarding.start")}>
      <form onSubmit={(e) => void save.run(e)} noValidate data-testid="application-form">
        <div className="grid-2">
          <TextField
            label={t("onboarding.legalName")}
            value={form.legalName}
            onChange={set("legalName")}
            error={fe["legalName"]}
            required
          />
          <TextField
            label={t("onboarding.brandName")}
            value={form.brandName}
            onChange={set("brandName")}
            error={fe["brandName"]}
            required
          />
          <TextField
            label={t("onboarding.license")}
            value={form.licenseNumber}
            onChange={set("licenseNumber")}
            error={fe["licenseNumber"]}
            required
          />
          <TextField
            label={t("onboarding.contactName")}
            value={form.name}
            onChange={set("name")}
            error={fe["contact.name"]}
            required
          />
          <TextField
            label={t("onboarding.contactEmail")}
            type="email"
            value={form.email}
            onChange={set("email")}
            error={fe["contact.email"]}
            required
          />
          <TextField
            label={t("onboarding.contactPhone")}
            type="tel"
            value={form.phone}
            onChange={set("phone")}
            error={fe["contact.phone"]}
            hint="+971 50 000 0000"
            required
          />
        </div>
        <ActionError error={save.error} />
        <Button type="submit" loading={save.pending}>
          {t("common.save")}
        </Button>
      </form>
    </Card>
  );
}

function Application({ app, onChanged }: { app: MerchantApplication; onChanged: () => void }) {
  const { t, locale } = useI18n();
  const api = useApi();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [docType, setDocType] = useState<
    "trade_license" | "owner_id" | "vat_certificate" | "other"
  >("trade_license");
  const editable = app.status === "draft" || app.status === "rejected";
  const upload = useAction(async (file: File) => {
    if (file.size > MAX_DOCUMENT_BYTES) throw new Error(t("onboarding.tooLarge"));
    const mime = file.type as "application/pdf" | "image/jpeg" | "image/png";
    const ticket = (
      await api.post("/v1/uploads", uploadTicketResponseSchema, {
        purpose: "merchant_document",
        merchantId: app.id,
        documentType: docType,
        mime,
        size: file.size,
      })
    ).data;
    const put = await fetch(ticket.uploadUrl, {
      method: "PUT",
      headers: ticket.headers,
      body: file,
    });
    if (!put.ok) throw new Error(t("onboarding.uploadFailed"));
    await api.post(`/v1/uploads/${ticket.id}/complete`, uploadResponseSchema);
    toast(t("onboarding.uploaded"));
    onChanged();
  });
  const submit = useAction(async () => {
    await api.post(
      `/v1/merchant/applications/${app.id}/submit`,
      merchantApplicationResponseSchema,
      { documentIds: app.documents.filter((d) => d.reviewStatus !== "rejected").map((d) => d.id) },
    );
    toast(t("onboarding.submitted"));
    onChanged();
  });
  return (
    <Card
      title={app.brandName}
      actions={
        <StatusChip tone={statusTone[app.status]}>{t(`merchantStatus.${app.status}`)}</StatusChip>
      }
    >
      <div className="stack">
        <Banner tone={statusTone[app.status] ?? "info"}>
          {t(`onboarding.next.${app.status}`)}
        </Banner>
        {app.reviewNote ? (
          <Banner tone="warning">
            <strong>{t("onboarding.reviewNote")}:</strong> {app.reviewNote}
          </Banner>
        ) : null}
        <DefinitionList
          items={[
            [t("onboarding.legalName"), app.legalName],
            [t("onboarding.license"), app.licenseNumber],
            [t("onboarding.contactName"), app.contact.name ?? "—"],
            [t("onboarding.contactEmail"), app.contact.email ?? "—"],
            [t("onboarding.submittedAt"), formatDateTime(app.submittedAt, locale)],
            [t("onboarding.reviewedAt"), formatDateTime(app.reviewedAt, locale)],
          ]}
        />
        {editable ? (
          editing ? (
            <ApplicationForm
              app={app}
              onSaved={() => {
                setEditing(false);
                onChanged();
              }}
            />
          ) : (
            <div>
              <Button variant="secondary" onClick={() => setEditing(true)}>
                {t("onboarding.edit")}
              </Button>
            </div>
          )
        ) : null}
        <h3>{t("onboarding.documents")}</h3>
        {app.documents.length === 0 ? (
          <p className="muted">{t("onboarding.noDocuments")}</p>
        ) : (
          <ul>
            {app.documents.map((d) => (
              <li key={d.id} className="row">
                <span>{t(`docType.${d.type}`)}</span>
                <StatusChip
                  tone={
                    d.fileStatus === "clean"
                      ? "success"
                      : d.fileStatus === "rejected"
                        ? "error"
                        : "warning"
                  }
                >
                  {t(`fileStatus.${d.fileStatus}`)}
                </StatusChip>
                <StatusChip
                  tone={
                    d.reviewStatus === "accepted"
                      ? "success"
                      : d.reviewStatus === "rejected"
                        ? "error"
                        : "neutral"
                  }
                >
                  {t(`reviewStatus.${d.reviewStatus}`)}
                </StatusChip>
              </li>
            ))}
          </ul>
        )}
        {editable ? (
          <div className="row">
            <SelectField
              label={t("onboarding.docType")}
              value={docType}
              onChange={(e) => setDocType(e.target.value as typeof docType)}
              options={(["trade_license", "owner_id", "vat_certificate", "other"] as const).map(
                (v) => ({ value: v, label: t(`docType.${v}`) }),
              )}
            />
            <label className="btn btn-secondary">
              {upload.pending ? t("common.loading") : t("onboarding.upload")}
              <input
                type="file"
                accept="application/pdf,image/jpeg,image/png"
                className="sr-only"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void upload.run(f);
                  e.target.value = "";
                }}
                data-testid="document-input"
              />
            </label>
            <Button variant="ghost" onClick={onChanged}>
              {t("onboarding.refresh")}
            </Button>
          </div>
        ) : null}
        <p className="muted small">{t("onboarding.fileRules")}</p>
        <ActionError error={upload.error ?? submit.error} />
        {editable ? (
          <div>
            <Button
              onClick={() => void submit.run()}
              loading={submit.pending}
              disabled={app.documents.length === 0}
              data-testid="submit-application"
            >
              {t("onboarding.submit")}
            </Button>
          </div>
        ) : null}
      </div>
    </Card>
  );
}
