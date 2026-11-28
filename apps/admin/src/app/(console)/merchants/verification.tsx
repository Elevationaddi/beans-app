"use client";
import {
  adminMerchantDetailResponseSchema,
  createVerifiedMerchantResponseSchema,
  emirateSchema,
  type AdminMerchantDetail,
} from "@beans/contracts";
import {
  ActionError,
  Banner,
  Button,
  Dialog,
  SelectField,
  TextArea,
  TextField,
  formatDateTime,
  useAction,
  useApi,
  useI18n,
  useToast,
} from "@beans/web";
import { useState, type FormEvent } from "react";
import { merchantPortalUrl } from "../../../lib/config";

/** Today in the UAE as YYYY-MM-DD, the default verification date. */
function today(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dubai" }).format(new Date());
}

const CHECKABLE = ["submitted", "review", "approved", "suspended"];

/**
 * Manual licence checks (cycle 4). A person checks the trade licence against an outside source
 * and records it here. The screen says so plainly: it is never an automatic government check.
 */
export function VerificationSection({
  merchant,
  canAct,
  onChanged,
}: {
  merchant: AdminMerchantDetail;
  canAct: boolean;
  onChanged: () => void;
}) {
  const { t } = useI18n();
  const [recording, setRecording] = useState(false);
  return (
    <section className="stack" data-testid="licence-checks">
      <h3>{t("verify.checks")}</h3>
      <p className="muted small">{t("verify.manualOnly")}</p>
      {merchant.verifications.length === 0 ? (
        <Banner tone="warning">{t("verify.noChecks")}</Banner>
      ) : (
        <ul className="stack">
          {merchant.verifications.map((v) => (
            <li key={v.id} className="card-lite">
              <strong>
                {t("verify.checkedBy", {
                  name: v.verifiedBy.name ?? "—",
                  date: v.verifiedOn,
                })}
              </strong>
              <div className="small">
                {t("verify.checkLine", {
                  number: v.licenseNumber,
                  authority: v.licenseAuthority,
                  expiry: v.licenseExpiresOn,
                })}
              </div>
              <div className="small">
                {t("verify.source")}: {v.source}
              </div>
              {v.notes ? <div className="small muted">{v.notes}</div> : null}
            </li>
          ))}
        </ul>
      )}
      {canAct && CHECKABLE.includes(merchant.status) ? (
        <div>
          <Button
            variant="secondary"
            onClick={() => setRecording(true)}
            data-testid="record-licence-check"
          >
            {t("verify.record")}
          </Button>
        </div>
      ) : null}
      {recording ? (
        <RecordCheckDialog
          merchant={merchant}
          onClose={() => setRecording(false)}
          onDone={() => {
            setRecording(false);
            onChanged();
          }}
        />
      ) : null}
    </section>
  );
}

function RecordCheckDialog({
  merchant,
  onClose,
  onDone,
}: {
  merchant: AdminMerchantDetail;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useI18n();
  const api = useApi();
  const toast = useToast();
  const [form, setForm] = useState({
    verifiedOn: today(),
    licenseNumber: merchant.licenseNumber,
    licenseAuthority: merchant.licenseAuthority ?? "",
    licenseExpiresOn: merchant.licenseExpiresOn ?? "",
    source: "",
    notes: "",
  });
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm({ ...form, [k]: e.target.value });
  const save = useAction(async (e: FormEvent) => {
    e.preventDefault();
    await api.post(
      `/v1/admin/merchants/${merchant.id}/verifications`,
      adminMerchantDetailResponseSchema,
      {
        verifiedOn: form.verifiedOn,
        licenseNumber: form.licenseNumber,
        licenseAuthority: form.licenseAuthority,
        licenseExpiresOn: form.licenseExpiresOn,
        source: form.source,
        ...(form.notes.trim() && { notes: form.notes }),
      },
    );
    toast(t("common.saved"));
    onDone();
  });
  const fe = save.error?.fieldErrors ?? {};
  return (
    <Dialog open title={t("verify.record")} onClose={onClose}>
      <form onSubmit={(e) => void save.run(e)} noValidate data-testid="licence-check-form">
        <Banner tone="info">{t("verify.manualOnly")}</Banner>
        <div className="grid-2">
          <TextField
            label={t("verify.verifiedOn")}
            type="date"
            value={form.verifiedOn}
            onChange={set("verifiedOn")}
            error={fe["verifiedOn"]}
            required
          />
          <TextField
            label={t("merchants.license")}
            value={form.licenseNumber}
            onChange={set("licenseNumber")}
            error={fe["licenseNumber"]}
            required
          />
          <TextField
            label={t("verify.authority")}
            value={form.licenseAuthority}
            onChange={set("licenseAuthority")}
            error={fe["licenseAuthority"]}
            required
          />
          <TextField
            label={t("verify.expiry")}
            type="date"
            value={form.licenseExpiresOn}
            onChange={set("licenseExpiresOn")}
            error={fe["licenseExpiresOn"]}
            required
          />
        </div>
        <TextField
          label={t("verify.source")}
          hint={t("verify.sourceHint")}
          value={form.source}
          onChange={set("source")}
          error={fe["source"]}
          required
        />
        <TextArea
          label={t("verify.notes")}
          value={form.notes}
          onChange={set("notes")}
          error={fe["notes"]}
        />
        <ActionError error={save.error} />
        <Button type="submit" loading={save.pending} data-testid="licence-check-save">
          {t("verify.save")}
        </Button>
      </form>
    </Dialog>
  );
}

/** Internal notes: visible to administrators only, never to the business. */
export function NotesSection({
  merchant,
  canAct,
  onChanged,
}: {
  merchant: AdminMerchantDetail;
  canAct: boolean;
  onChanged: () => void;
}) {
  const { t, locale } = useI18n();
  const api = useApi();
  const [body, setBody] = useState("");
  const add = useAction(async (e: FormEvent) => {
    e.preventDefault();
    await api.post(`/v1/admin/merchants/${merchant.id}/notes`, adminMerchantDetailResponseSchema, {
      body,
    });
    setBody("");
    onChanged();
  });
  return (
    <section className="stack" data-testid="internal-notes">
      <h3>{t("verify.notesTitle")}</h3>
      <p className="muted small">{t("verify.notesHint")}</p>
      {merchant.notes.length === 0 ? (
        <p className="muted">{t("verify.noNotes")}</p>
      ) : (
        <ul className="stack">
          {merchant.notes.map((n) => (
            <li key={n.id} className="card-lite">
              <div className="small muted">
                {n.author.name ?? "—"} · {formatDateTime(n.createdAt, locale)}
              </div>
              <div>{n.body}</div>
            </li>
          ))}
        </ul>
      )}
      {canAct ? (
        <form onSubmit={(e) => void add.run(e)} noValidate>
          <TextArea
            label={t("verify.addNote")}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            error={add.error?.fieldErrors?.["body"]}
            maxLength={2000}
          />
          <ActionError error={add.error} />
          <Button type="submit" variant="secondary" loading={add.pending} disabled={!body.trim()}>
            {t("verify.saveNote")}
          </Button>
        </form>
      ) : null}
    </section>
  );
}

/** Verification history: every audited action on this merchant, newest first. */
export function HistorySection({ merchant }: { merchant: AdminMerchantDetail }) {
  const { t, locale } = useI18n();
  /** Known actions get a readable label; anything new falls back to the raw audit action. */
  const historyLabel = (action: string) => {
    const key = `history.${action}`;
    const label = t(key);
    return label === key ? action : label;
  };
  return (
    <section className="stack" data-testid="merchant-history">
      <h3>{t("verify.history")}</h3>
      <ul className="stack small">
        {merchant.history.map((h) => (
          <li key={h.id}>
            <strong>{historyLabel(h.action)}</strong> · {formatDateTime(h.at, locale)} ·{" "}
            {h.actorName ?? "—"}
            {h.reason ? <span className="muted"> · {h.reason}</span> : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Create an approved merchant that was verified outside the platform, then invite its owner. */
export function CreateVerifiedMerchantDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const { t } = useI18n();
  const api = useApi();
  const [token, setToken] = useState<string | null>(null);
  const [form, setForm] = useState({
    legalName: "",
    brandName: "",
    licenseNumber: "",
    licenseAuthority: "",
    licenseExpiresOn: "",
    emirate: "abu_dhabi",
    contactName: "",
    contactEmail: "",
    contactPhone: "",
    repName: "",
    repPosition: "",
    repEmail: "",
    repPhone: "",
    declaredBranchCount: "1",
    description: "",
    ownerEmail: "",
    verifiedOn: today(),
    source: "",
    notes: "",
    reason: "",
  });
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm({ ...form, [k]: e.target.value });
  const save = useAction(async (e: FormEvent) => {
    e.preventDefault();
    const res = await api.post("/v1/admin/merchants", createVerifiedMerchantResponseSchema, {
      legalName: form.legalName,
      brandName: form.brandName,
      licenseNumber: form.licenseNumber,
      licenseAuthority: form.licenseAuthority,
      licenseExpiresOn: form.licenseExpiresOn,
      emirate: emirateSchema.parse(form.emirate),
      contact: { name: form.contactName, email: form.contactEmail, phone: form.contactPhone },
      representative: {
        name: form.repName,
        position: form.repPosition,
        email: form.repEmail,
        phone: form.repPhone,
      },
      declaredBranchCount: Number(form.declaredBranchCount),
      ...(form.description.trim() && { description: form.description }),
      ownerEmail: form.ownerEmail,
      verification: {
        verifiedOn: form.verifiedOn,
        source: form.source,
        ...(form.notes.trim() && { notes: form.notes }),
      },
      reason: form.reason,
    });
    setToken(res.data.ownerInvitationToken);
    onCreated();
  });
  const fe = save.error?.fieldErrors ?? {};
  if (token) {
    return (
      <Dialog open title={t("verify.createdTitle")} onClose={onClose}>
        <Banner tone="success">{t("verify.created")}</Banner>
        <p>{t("verify.inviteHelp")}</p>
        <code className="break" data-testid="owner-invite-path">
          {`${merchantPortalUrl}/invite?token=${token}`}
        </code>
        <p className="muted small">{t("verify.inviteOnce")}</p>
      </Dialog>
    );
  }
  return (
    <Dialog open wide title={t("verify.create")} onClose={onClose}>
      <form onSubmit={(e) => void save.run(e)} noValidate data-testid="create-merchant-form">
        <Banner tone="info">{t("verify.manualOnly")}</Banner>
        <div className="grid-2">
          <TextField
            label={t("merchants.brand")}
            value={form.brandName}
            onChange={set("brandName")}
            error={fe["brandName"]}
            required
          />
          <TextField
            label={t("merchants.legal")}
            value={form.legalName}
            onChange={set("legalName")}
            error={fe["legalName"]}
            required
          />
          <TextField
            label={t("merchants.license")}
            value={form.licenseNumber}
            onChange={set("licenseNumber")}
            error={fe["licenseNumber"]}
            required
          />
          <TextField
            label={t("verify.authority")}
            value={form.licenseAuthority}
            onChange={set("licenseAuthority")}
            error={fe["licenseAuthority"]}
            required
          />
          <TextField
            label={t("verify.expiry")}
            type="date"
            value={form.licenseExpiresOn}
            onChange={set("licenseExpiresOn")}
            error={fe["licenseExpiresOn"]}
            required
          />
          <SelectField
            label={t("verify.emirate")}
            value={form.emirate}
            onChange={set("emirate")}
            options={emirateSchema.options.map((v) => ({ value: v, label: t(`emirate.${v}`) }))}
          />
          <TextField
            label={t("verify.contactName")}
            value={form.contactName}
            onChange={set("contactName")}
            error={fe["contact.name"]}
            required
          />
          <TextField
            label={t("verify.contactEmail")}
            type="email"
            value={form.contactEmail}
            onChange={set("contactEmail")}
            error={fe["contact.email"]}
            required
          />
          <TextField
            label={t("verify.contactPhone")}
            type="tel"
            value={form.contactPhone}
            onChange={set("contactPhone")}
            error={fe["contact.phone"]}
            required
          />
          <TextField
            label={t("verify.branchCount")}
            type="number"
            min={1}
            max={500}
            value={form.declaredBranchCount}
            onChange={set("declaredBranchCount")}
            error={fe["declaredBranchCount"]}
            required
          />
          <TextField
            label={t("verify.repName")}
            value={form.repName}
            onChange={set("repName")}
            error={fe["representative.name"]}
            required
          />
          <TextField
            label={t("verify.repPosition")}
            value={form.repPosition}
            onChange={set("repPosition")}
            error={fe["representative.position"]}
            required
          />
          <TextField
            label={t("verify.repEmail")}
            type="email"
            value={form.repEmail}
            onChange={set("repEmail")}
            error={fe["representative.email"]}
            required
          />
          <TextField
            label={t("verify.repPhone")}
            type="tel"
            value={form.repPhone}
            onChange={set("repPhone")}
            error={fe["representative.phone"]}
            required
          />
          <TextField
            label={t("verify.ownerEmail")}
            type="email"
            value={form.ownerEmail}
            onChange={set("ownerEmail")}
            error={fe["ownerEmail"]}
            required
          />
          <TextField
            label={t("verify.verifiedOn")}
            type="date"
            value={form.verifiedOn}
            onChange={set("verifiedOn")}
            error={fe["verifiedOn"] ?? fe["verification.verifiedOn"]}
            required
          />
        </div>
        <TextArea
          label={t("verify.description")}
          value={form.description}
          onChange={set("description")}
        />
        <TextField
          label={t("verify.source")}
          hint={t("verify.sourceHint")}
          value={form.source}
          onChange={set("source")}
          error={fe["verification.source"]}
          required
        />
        <TextArea label={t("verify.notes")} value={form.notes} onChange={set("notes")} />
        <TextField
          label={t("common.reason")}
          value={form.reason}
          onChange={set("reason")}
          error={fe["reason"]}
          required
        />
        <ActionError error={save.error} />
        <Button type="submit" loading={save.pending} data-testid="create-merchant-save">
          {t("verify.createSave")}
        </Button>
      </form>
    </Dialog>
  );
}
