"use client";
import {
  adminMerchantDetailResponseSchema,
  adminMerchantListResponseSchema,
  merchantStatusSchema,
  type ReviewDecision,
} from "@beans/contracts";
import {
  Banner,
  Button,
  DataTable,
  DefinitionList,
  Dialog,
  ErrorState,
  FilterBar,
  LoadMore,
  Loading,
  PageHeader,
  SelectField,
  StatusChip,
  formatDateTime,
  useApi,
  useI18n,
  usePaged,
  useQuery,
} from "@beans/web";
import { useState } from "react";
import { z } from "zod";
import { statusTone, useRoles } from "../../../lib/admin";
import { NoAccess, ReasonDialog } from "../../../lib/ui";

type Summary = {
  id: string;
  legalName: string;
  brandName: string;
  status: string;
  submittedAt: string | null;
  branchCount: number;
};

const statusResponse = z.object({ data: z.object({ id: z.string(), status: z.string() }) });

/** Decisions offered for each status; the API checks the transition and the role again. */
const REVIEW_ACTIONS: Record<string, ReviewDecision[]> = {
  submitted: ["start_review"],
  review: ["approve", "request_changes", "reject"],
};

/** A02: merchant verification queue, review decisions with reasons, suspend and restore. */
export default function MerchantsPage() {
  const { t, locale } = useI18n();
  const api = useApi();
  const { can } = useRoles();
  const [status, setStatus] = useState("submitted");
  const [openId, setOpenId] = useState<string | null>(null);
  const list = usePaged(
    (cursor, signal) =>
      api.get(
        "/v1/admin/merchants",
        adminMerchantListResponseSchema,
        { status, cursor, limit: 25 },
        signal,
      ),
    [status],
  );
  if (!can("operations", "super_admin")) return <NoAccess />;
  return (
    <>
      <PageHeader title={t("merchants.title")} subtitle={t("merchants.subtitle")} />
      <FilterBar>
        <SelectField
          label={t("common.status")}
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          data-testid="merchant-status-filter"
          options={[
            { value: "", label: t("common.all") },
            ...merchantStatusSchema.options.map((s) => ({
              value: s,
              label: t(`merchantStatus.${s}`),
            })),
          ]}
        />
      </FilterBar>
      {list.error ? <ErrorState error={list.error} onRetry={list.reload} /> : null}
      <DataTable<Summary>
        caption={t("merchants.title")}
        rows={list.items}
        rowKey={(r) => r.id}
        onRowClick={(r) => setOpenId(r.id)}
        emptyText={list.loading ? t("common.loading") : t("merchants.empty")}
        columns={[
          { key: "brand", header: t("merchants.brand"), render: (r) => r.brandName },
          { key: "legal", header: t("merchants.legal"), render: (r) => r.legalName },
          {
            key: "status",
            header: t("common.status"),
            render: (r) => (
              <StatusChip tone={statusTone[r.status]}>{t(`merchantStatus.${r.status}`)}</StatusChip>
            ),
          },
          { key: "branches", header: t("merchants.branches"), render: (r) => r.branchCount },
          {
            key: "submitted",
            header: t("merchants.submitted"),
            render: (r) => formatDateTime(r.submittedAt, locale),
          },
        ]}
      />
      <LoadMore hasMore={list.hasMore} loading={list.loading} onMore={() => void list.more()} />
      {openId ? (
        <MerchantDialog id={openId} onClose={() => setOpenId(null)} onChanged={list.reload} />
      ) : null}
    </>
  );
}

function MerchantDialog({
  id,
  onClose,
  onChanged,
}: {
  id: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { t, locale } = useI18n();
  const api = useApi();
  const { can } = useRoles();
  const [decision, setDecision] = useState<ReviewDecision | "suspend" | "restore" | null>(null);
  const detail = useQuery(
    async (signal) =>
      (await api.get(`/v1/admin/merchants/${id}`, adminMerchantDetailResponseSchema, {}, signal))
        .data,
    [id],
  );
  const m = detail.data;
  const reviewActions = m && can("operations") ? (REVIEW_ACTIONS[m.status] ?? []) : [];
  return (
    <Dialog open wide title={m?.brandName ?? t("merchants.title")} onClose={onClose}>
      {detail.error && !m ? <ErrorState error={detail.error} onRetry={detail.reload} /> : null}
      {!m && !detail.error ? <Loading /> : null}
      {m ? (
        <>
          <DefinitionList
            items={[
              [t("merchants.legal"), m.legalName],
              [t("merchants.license"), m.licenseNumber],
              [
                t("common.status"),
                <StatusChip key="s" tone={statusTone[m.status]}>
                  {t(`merchantStatus.${m.status}`)}
                </StatusChip>,
              ],
              [
                t("merchants.contact"),
                [m.contact.name, m.contact.email, m.contact.phone].filter(Boolean).join(" · "),
              ],
              [t("merchants.submitted"), formatDateTime(m.submittedAt, locale)],
              [t("merchants.reviewed"), formatDateTime(m.reviewedAt, locale)],
              [t("merchants.branches"), m.branchCount],
              [t("merchants.note"), m.reviewNote ?? "—"],
            ]}
          />
          <h3>{t("merchants.documents")}</h3>
          {m.documents.length === 0 ? (
            <Banner tone="warning">{t("merchants.noDocuments")}</Banner>
          ) : (
            <ul className="stack" data-testid="merchant-documents">
              {m.documents.map((d) => (
                <li key={d.id} className="row">
                  <strong>{t(`docType.${d.type}`)}</strong>
                  <StatusChip tone={d.fileStatus === "clean" ? "success" : "warning"}>
                    {t(`fileStatus.${d.fileStatus}`)}
                  </StatusChip>
                  {d.downloadUrl ? (
                    <a href={d.downloadUrl} target="_blank" rel="noreferrer noopener">
                      {t("merchants.open")}
                    </a>
                  ) : (
                    <span className="muted small">{t("merchants.notScanned")}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
          <div className="row" style={{ marginBlockStart: 16 }}>
            {reviewActions.map((a) => (
              <Button
                key={a}
                variant={a === "reject" ? "destructive" : a === "approve" ? "primary" : "secondary"}
                onClick={() => setDecision(a)}
                data-testid={`review-${a}`}
              >
                {t(`review.${a}`)}
              </Button>
            ))}
            {m.status === "approved" ? (
              <Button
                variant="destructive"
                onClick={() => setDecision("suspend")}
                data-testid="merchant-suspend"
              >
                {t("merchants.suspend")}
              </Button>
            ) : null}
            {m.status === "suspended" ? (
              <Button onClick={() => setDecision("restore")} data-testid="merchant-restore">
                {t("merchants.restore")}
              </Button>
            ) : null}
          </div>
        </>
      ) : null}
      {decision && m ? (
        <ReasonDialog
          title={t(
            decision === "suspend"
              ? "merchants.suspend"
              : decision === "restore"
                ? "merchants.restore"
                : `review.${decision}`,
          )}
          body={<p>{t(`reviewHint.${decision}`)}</p>}
          confirmLabel={t("common.confirm")}
          destructive={decision === "reject" || decision === "suspend"}
          onConfirm={(reason) =>
            decision === "suspend" || decision === "restore"
              ? api.post(`/v1/admin/merchants/${id}/status`, statusResponse, {
                  status: decision === "suspend" ? "suspended" : "approved",
                  reason,
                })
              : api.post(`/v1/admin/merchants/${id}/review`, adminMerchantDetailResponseSchema, {
                  decision,
                  reason,
                  expectedStatus: m.status,
                })
          }
          onClose={() => setDecision(null)}
          onDone={() => {
            setDecision(null);
            detail.reload();
            onChanged();
          }}
        />
      ) : null}
    </Dialog>
  );
}
