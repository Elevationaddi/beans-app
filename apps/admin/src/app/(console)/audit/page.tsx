"use client";
import { auditListResponseSchema, type AuditEventView } from "@beans/contracts";
import {
  Button,
  DataTable,
  Dialog,
  ErrorState,
  FilterBar,
  LoadMore,
  PageHeader,
  SelectField,
  TextField,
  formatDateTime,
  useApi,
  useI18n,
  usePaged,
} from "@beans/web";
import { useState } from "react";
import { shortId, useRoles } from "../../../lib/admin";
import { JsonBlock, NoAccess } from "../../../lib/ui";

/** Action families written by the API (AuditService). */
const PREFIXES = [
  "",
  "admin.",
  "platform.",
  "user.",
  "merchant.",
  "branch.",
  "catalog.",
  "staff.",
  "order.",
  "refund.",
  "payout.",
  "reconciliation.",
  "dispute.",
  "ticket.",
  "privacy.",
  "notification.",
  "report.",
  "audit.",
];

/** A10: redacted audit trail and security log. Viewing it is itself audited. */
export default function AuditPage() {
  const { t, locale } = useI18n();
  const api = useApi();
  const { can } = useRoles();
  const [prefix, setPrefix] = useState("");
  const [targetInput, setTargetInput] = useState("");
  const [targetId, setTargetId] = useState("");
  const [open, setOpen] = useState<AuditEventView | null>(null);
  const list = usePaged(
    (cursor, signal) =>
      api.get(
        "/v1/admin/audit",
        auditListResponseSchema,
        { actionPrefix: prefix, targetId, cursor, limit: 50 },
        signal,
      ),
    [prefix, targetId],
  );
  if (!can("security")) return <NoAccess />;
  return (
    <>
      <PageHeader title={t("audit.title")} subtitle={t("audit.subtitle")} />
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setTargetId(targetInput.trim());
        }}
      >
        <FilterBar>
          <SelectField
            label={t("audit.area")}
            value={prefix}
            onChange={(e) => setPrefix(e.target.value)}
            data-testid="audit-prefix"
            options={PREFIXES.map((p) => ({
              value: p,
              label: p ? p.replace(/\.$/, "") : t("common.all"),
            }))}
          />
          <TextField
            label={t("audit.target")}
            value={targetInput}
            onChange={(e) => setTargetInput(e.target.value)}
          />
          <Button type="submit" variant="secondary">
            {t("common.search")}
          </Button>
        </FilterBar>
      </form>
      {list.error ? <ErrorState error={list.error} onRetry={list.reload} /> : null}
      <DataTable<AuditEventView>
        caption={t("audit.title")}
        rows={list.items}
        rowKey={(r) => r.id}
        onRowClick={setOpen}
        emptyText={list.loading ? t("common.loading") : t("audit.empty")}
        columns={[
          {
            key: "w",
            header: t("common.when"),
            render: (r) => formatDateTime(r.createdAt, locale),
          },
          {
            key: "a",
            header: t("audit.action"),
            render: (r) => <span className="mono">{r.action}</span>,
          },
          { key: "actor", header: t("audit.actor"), render: (r) => shortId(r.actorId) },
          {
            key: "t",
            header: t("audit.target"),
            render: (r) => `${r.targetType} ${r.targetId.slice(0, 8)}`,
          },
          { key: "r", header: t("common.reason"), render: (r) => r.reason ?? "—" },
        ]}
      />
      <LoadMore hasMore={list.hasMore} loading={list.loading} onMore={() => void list.more()} />
      {open ? (
        <Dialog open wide title={open.action} onClose={() => setOpen(null)}>
          <p className="muted small">
            {formatDateTime(open.createdAt, locale)} · {t("audit.request", { id: open.requestId })}
          </p>
          <div className="grid-2">
            <div>
              <h3>{t("audit.before")}</h3>
              <JsonBlock value={open.before} />
            </div>
            <div>
              <h3>{t("audit.after")}</h3>
              <JsonBlock value={open.after} />
            </div>
          </div>
        </Dialog>
      ) : null}
    </>
  );
}
