"use client";
import {
  adminPaymentListResponseSchema,
  disputeListResponseSchema,
  disputeResponseSchema,
  payoutListResponseSchema,
  payoutResponseSchema,
  reconciliationExceptionResponseSchema,
  reconciliationListResponseSchema,
  reconciliationRunResponseSchema,
  refundListResponseSchema,
  refundResponseSchema,
  trialBalanceResponseSchema,
  type AdminPayment,
  type DisputeView,
  type PayoutView,
  type ReconciliationExceptionView,
  type RefundView,
} from "@beans/contracts";
import {
  ActionError,
  Banner,
  Button,
  DataTable,
  Dialog,
  ErrorState,
  FilterBar,
  LoadMore,
  PageHeader,
  QueryView,
  SelectField,
  Stat,
  StatusChip,
  Tabs,
  TextArea,
  TextField,
  formatDateTime,
  formatFils,
  useAction,
  useApi,
  useI18n,
  usePaged,
  useQuery,
  useToast,
} from "@beans/web";
import { useState } from "react";
import { aedToFils, filsToAed, shortId, statusTone, useRoles } from "../../../lib/admin";
import { JsonBlock, NoAccess, ReasonDialog } from "../../../lib/ui";

type Tab = "payments" | "refunds" | "payouts" | "reconciliation" | "disputes" | "ledger";

/**
 * A05: payments, refunds, payouts, reconciliation, disputes and the ledger. Every money
 * decision is maker/checker: a finance maker proposes, a different finance checker decides,
 * and the API refuses the same person doing both. Sandbox provider only; no real money moves.
 */
export default function FinancePage() {
  const { t } = useI18n();
  const { can } = useRoles();
  const [tab, setTab] = useState<Tab>("payments");
  if (!can("finance_maker", "finance_checker")) return <NoAccess />;
  return (
    <>
      <PageHeader title={t("finance.title")} subtitle={t("finance.subtitle")} />
      <Banner tone="info">{t("finance.makerChecker")}</Banner>
      <Tabs<Tab>
        label={t("finance.title")}
        value={tab}
        onChange={setTab}
        tabs={(
          ["payments", "refunds", "payouts", "reconciliation", "disputes", "ledger"] as Tab[]
        ).map((v) => ({ value: v, label: t(`finance.tab.${v}`) }))}
      />
      {tab === "payments" ? <Payments /> : null}
      {tab === "refunds" ? <Refunds /> : null}
      {tab === "payouts" ? <Payouts /> : null}
      {tab === "reconciliation" ? <Reconciliation /> : null}
      {tab === "disputes" ? <Disputes /> : null}
      {tab === "ledger" ? <Ledger /> : null}
    </>
  );
}

function StatusFilter({
  value,
  onChange,
  options,
  prefix,
}: {
  value: string;
  onChange: (v: string) => void;
  options: string[];
  prefix: string;
}) {
  const { t } = useI18n();
  return (
    <FilterBar>
      <SelectField
        label={t("common.status")}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        options={[
          { value: "", label: t("common.all") },
          ...options.map((s) => ({ value: s, label: t(`${prefix}.${s}`) })),
        ]}
      />
    </FilterBar>
  );
}

// ── Payments ────────────────────────────────────────────────────────────────

function Payments() {
  const { t, locale } = useI18n();
  const api = useApi();
  const { can } = useRoles();
  const [status, setStatus] = useState("captured");
  const [refundFor, setRefundFor] = useState<AdminPayment | null>(null);
  const [disputeFor, setDisputeFor] = useState<AdminPayment | null>(null);
  const list = usePaged(
    (cursor, signal) =>
      api.get(
        "/v1/admin/payments",
        adminPaymentListResponseSchema,
        { status, cursor, limit: 25 },
        signal,
      ),
    [status],
  );
  return (
    <>
      <StatusFilter
        value={status}
        onChange={setStatus}
        options={["pending", "captured", "failed"]}
        prefix="paymentStatus"
      />
      {list.error ? <ErrorState error={list.error} onRetry={list.reload} /> : null}
      <DataTable<AdminPayment>
        caption={t("finance.tab.payments")}
        rows={list.items}
        rowKey={(r) => r.id}
        emptyText={list.loading ? t("common.loading") : t("finance.noPayments")}
        columns={[
          { key: "o", header: t("orders.number"), render: (r) => <bdi>{r.orderNumber}</bdi> },
          { key: "m", header: t("orders.shop"), render: (r) => r.brandName },
          {
            key: "s",
            header: t("common.status"),
            render: (r) => (
              <StatusChip tone={statusTone[r.status]}>{t(`paymentStatus.${r.status}`)}</StatusChip>
            ),
          },
          { key: "a", header: t("common.amount"), render: (r) => formatFils(r.amountFils, locale) },
          {
            key: "r",
            header: t("finance.refunded"),
            render: (r) =>
              `${formatFils(r.refundedFils, locale)} / ${formatFils(r.refundCommittedFils, locale)}`,
          },
          { key: "p", header: t("orders.provider"), render: (r) => r.provider },
          {
            key: "w",
            header: t("common.when"),
            render: (r) => formatDateTime(r.createdAt, locale),
          },
          {
            key: "act",
            header: t("common.actions"),
            render: (r) =>
              r.status === "captured" && can("finance_maker") ? (
                <span className="row">
                  <Button
                    variant="secondary"
                    onClick={() => setRefundFor(r)}
                    disabled={BigInt(r.refundCommittedFils) >= BigInt(r.amountFils)}
                    data-testid={`refund-${r.orderNumber}`}
                  >
                    {t("finance.requestRefund")}
                  </Button>
                  <Button variant="ghost" onClick={() => setDisputeFor(r)}>
                    {t("finance.simulateDispute")}
                  </Button>
                </span>
              ) : null,
          },
        ]}
      />
      <LoadMore hasMore={list.hasMore} loading={list.loading} onMore={() => void list.more()} />
      {refundFor ? (
        <AmountDialog
          title={t("finance.requestRefund")}
          hint={t("finance.refundHint", {
            max: formatFils(
              (BigInt(refundFor.amountFils) - BigInt(refundFor.refundCommittedFils)).toString(),
              locale,
            ),
          })}
          initial={filsToAed(
            (BigInt(refundFor.amountFils) - BigInt(refundFor.refundCommittedFils)).toString(),
          )}
          onSubmit={(amountFils, reason) =>
            api.post("/v1/admin/refunds", refundResponseSchema, {
              paymentId: refundFor.id,
              amountFils,
              reason,
            })
          }
          onClose={() => setRefundFor(null)}
          onDone={() => {
            setRefundFor(null);
            list.reload();
          }}
        />
      ) : null}
      {disputeFor ? (
        <AmountDialog
          title={t("finance.simulateDispute")}
          hint={t("finance.simulateHint")}
          initial={filsToAed(disputeFor.amountFils)}
          onSubmit={(amountFils, reason) =>
            api.post("/v1/admin/disputes/simulate", disputeResponseSchema, {
              paymentId: disputeFor.id,
              amountFils,
              reason,
            })
          }
          onClose={() => setDisputeFor(null)}
          onDone={() => setDisputeFor(null)}
        />
      ) : null}
    </>
  );
}

function AmountDialog({
  title,
  hint,
  initial,
  onSubmit,
  onClose,
  onDone,
}: {
  title: string;
  hint: string;
  initial: string;
  onSubmit: (amountFils: string, reason: string) => Promise<unknown>;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useI18n();
  const toast = useToast();
  const [amount, setAmount] = useState(initial);
  const [reason, setReason] = useState("");
  const fils = aedToFils(amount);
  const action = useAction(async () => {
    if (!fils) return;
    await onSubmit(fils, reason.trim());
    toast(t("common.saved"));
    onDone();
  });
  return (
    <Dialog
      open
      title={title}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            loading={action.pending}
            disabled={!fils || reason.trim().length < 3}
            onClick={() => void action.run()}
            data-testid="amount-submit"
          >
            {t("common.confirm")}
          </Button>
        </>
      }
    >
      <p>{hint}</p>
      <TextField
        label={t("finance.amountAed")}
        inputMode="decimal"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        error={amount && !fils ? t("finance.amountInvalid") : undefined}
        data-testid="amount-input"
      />
      <TextArea
        label={t("common.reason")}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        maxLength={200}
        data-testid="amount-reason"
      />
      <ActionError error={action.error} />
    </Dialog>
  );
}

// ── Refunds ─────────────────────────────────────────────────────────────────

function Refunds() {
  const { t, locale } = useI18n();
  const api = useApi();
  const { can } = useRoles();
  const [status, setStatus] = useState("requested");
  const [decide, setDecide] = useState<{ row: RefundView; approve: boolean } | null>(null);
  const list = usePaged(
    (cursor, signal) =>
      api.get("/v1/admin/refunds", refundListResponseSchema, { status, cursor, limit: 25 }, signal),
    [status],
  );
  return (
    <>
      <StatusFilter
        value={status}
        onChange={setStatus}
        options={["requested", "approved", "rejected", "submitted", "succeeded", "failed"]}
        prefix="refundStatus"
      />
      {list.error ? <ErrorState error={list.error} onRetry={list.reload} /> : null}
      <DataTable<RefundView>
        caption={t("finance.tab.refunds")}
        rows={list.items}
        rowKey={(r) => r.id}
        emptyText={list.loading ? t("common.loading") : t("finance.noRefunds")}
        columns={[
          { key: "o", header: t("finance.order"), render: (r) => shortId(r.orderId) },
          { key: "k", header: t("common.type"), render: (r) => t(`refundKind.${r.kind}`) },
          {
            key: "s",
            header: t("common.status"),
            render: (r) => (
              <StatusChip tone={statusTone[r.status]}>{t(`refundStatus.${r.status}`)}</StatusChip>
            ),
          },
          { key: "a", header: t("common.amount"), render: (r) => formatFils(r.amountFils, locale) },
          { key: "r", header: t("common.reason"), render: (r) => r.reason },
          {
            key: "d",
            header: t("finance.decision"),
            render: (r) => r.decisionReason ?? r.failureCode ?? "—",
          },
          {
            key: "w",
            header: t("common.when"),
            render: (r) => formatDateTime(r.createdAt, locale),
          },
          {
            key: "act",
            header: t("common.actions"),
            render: (r) =>
              r.status === "requested" && can("finance_checker") ? (
                <span className="row">
                  <Button
                    onClick={() => setDecide({ row: r, approve: true })}
                    data-testid="refund-approve"
                  >
                    {t("finance.approve")}
                  </Button>
                  <Button variant="secondary" onClick={() => setDecide({ row: r, approve: false })}>
                    {t("finance.reject")}
                  </Button>
                </span>
              ) : null,
          },
        ]}
      />
      <LoadMore hasMore={list.hasMore} loading={list.loading} onMore={() => void list.more()} />
      {decide ? (
        <ReasonDialog
          title={t(decide.approve ? "finance.approveRefund" : "finance.rejectRefund")}
          body={
            <p>
              {formatFils(decide.row.amountFils, locale)} · {decide.row.reason}
            </p>
          }
          confirmLabel={t(decide.approve ? "finance.approve" : "finance.reject")}
          destructive={!decide.approve}
          onConfirm={(reason) =>
            api.post(
              `/v1/admin/refunds/${decide.row.id}/${decide.approve ? "approve" : "reject"}`,
              refundResponseSchema,
              { reason },
            )
          }
          onClose={() => setDecide(null)}
          onDone={() => {
            setDecide(null);
            list.reload();
          }}
        />
      ) : null}
    </>
  );
}

// ── Payouts ─────────────────────────────────────────────────────────────────

function Payouts() {
  const { t, locale } = useI18n();
  const api = useApi();
  const { can } = useRoles();
  const [status, setStatus] = useState("");
  const [drafting, setDrafting] = useState(false);
  const [decide, setDecide] = useState<{ row: PayoutView; approve: boolean } | null>(null);
  const list = usePaged(
    (cursor, signal) =>
      api.get("/v1/admin/payouts", payoutListResponseSchema, { status, cursor, limit: 25 }, signal),
    [status],
  );
  return (
    <>
      <div className="row">
        <StatusFilter
          value={status}
          onChange={setStatus}
          options={["pending_approval", "approved", "rejected", "submitted", "paid", "failed"]}
          prefix="payoutStatus"
        />
        {can("finance_maker") ? (
          <Button onClick={() => setDrafting(true)} data-testid="draft-payout">
            {t("finance.draftPayout")}
          </Button>
        ) : null}
      </div>
      <Banner tone="info">{t("finance.payoutSandbox")}</Banner>
      {list.error ? <ErrorState error={list.error} onRetry={list.reload} /> : null}
      <DataTable<PayoutView>
        caption={t("finance.tab.payouts")}
        rows={list.items}
        rowKey={(r) => r.id}
        emptyText={list.loading ? t("common.loading") : t("finance.noPayouts")}
        columns={[
          { key: "m", header: t("finance.merchant"), render: (r) => shortId(r.merchantId) },
          {
            key: "s",
            header: t("common.status"),
            render: (r) => (
              <StatusChip tone={statusTone[r.status]}>{t(`payoutStatus.${r.status}`)}</StatusChip>
            ),
          },
          { key: "a", header: t("common.amount"), render: (r) => formatFils(r.amountFils, locale) },
          {
            key: "p",
            header: t("finance.periodEnd"),
            render: (r) => formatDateTime(r.periodEnd, locale),
          },
          {
            key: "d",
            header: t("finance.decision"),
            render: (r) => r.decisionReason ?? r.failureCode ?? "—",
          },
          {
            key: "act",
            header: t("common.actions"),
            render: (r) =>
              r.status === "pending_approval" && can("finance_checker") ? (
                <span className="row">
                  <Button onClick={() => setDecide({ row: r, approve: true })}>
                    {t("finance.approve")}
                  </Button>
                  <Button variant="secondary" onClick={() => setDecide({ row: r, approve: false })}>
                    {t("finance.reject")}
                  </Button>
                </span>
              ) : null,
          },
        ]}
      />
      <LoadMore hasMore={list.hasMore} loading={list.loading} onMore={() => void list.more()} />
      {drafting ? (
        <DraftPayoutDialog
          onClose={() => setDrafting(false)}
          onDone={() => {
            setDrafting(false);
            list.reload();
          }}
        />
      ) : null}
      {decide ? (
        <ReasonDialog
          title={t(decide.approve ? "finance.approvePayout" : "finance.rejectPayout")}
          body={<p>{formatFils(decide.row.amountFils, locale)}</p>}
          confirmLabel={t(decide.approve ? "finance.approve" : "finance.reject")}
          destructive={!decide.approve}
          onConfirm={(reason) =>
            api.post(
              `/v1/admin/payouts/${decide.row.id}/${decide.approve ? "approve" : "reject"}`,
              payoutResponseSchema,
              { reason },
            )
          }
          onClose={() => setDecide(null)}
          onDone={() => {
            setDecide(null);
            list.reload();
          }}
        />
      ) : null}
    </>
  );
}

function DraftPayoutDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { t } = useI18n();
  const api = useApi();
  const toast = useToast();
  const [merchantId, setMerchantId] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  // Merchants with captured payments, so a finance maker can pick one without merchant access.
  const merchants = useQuery(async (signal) => {
    const page = await api.get(
      "/v1/admin/payments",
      adminPaymentListResponseSchema,
      { status: "captured", limit: 100 },
      signal,
    );
    const seen = new Map<string, string>();
    for (const p of page.data) seen.set(p.merchantId, p.brandName);
    return [...seen].map(([id, name]) => ({ id, name }));
  }, []);
  const action = useAction(async () => {
    // The end of the chosen Dubai day (UTC+4) is the cut-off.
    const end = new Date(`${periodEnd}T23:59:59.999+04:00`).toISOString();
    await api.post("/v1/admin/payouts", payoutResponseSchema, { merchantId, periodEnd: end });
    toast(t("common.saved"));
    onDone();
  });
  return (
    <Dialog
      open
      title={t("finance.draftPayout")}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            loading={action.pending}
            disabled={!merchantId || !periodEnd}
            onClick={() => void action.run()}
            data-testid="draft-payout-submit"
          >
            {t("finance.draftPayout")}
          </Button>
        </>
      }
    >
      <p>{t("finance.draftHint")}</p>
      <SelectField
        label={t("finance.merchant")}
        value={merchantId}
        onChange={(e) => setMerchantId(e.target.value)}
        options={[
          {
            value: "",
            label: merchants.loading ? t("common.loading") : t("finance.chooseMerchant"),
          },
          ...(merchants.data ?? []).map((m) => ({ value: m.id, label: m.name })),
        ]}
      />
      <TextField
        label={t("finance.periodEnd")}
        type="date"
        value={periodEnd}
        onChange={(e) => setPeriodEnd(e.target.value)}
      />
      <ActionError error={action.error ?? merchants.error} />
    </Dialog>
  );
}

// ── Reconciliation ──────────────────────────────────────────────────────────

function Reconciliation() {
  const { t, locale } = useI18n();
  const api = useApi();
  const toast = useToast();
  const { can } = useRoles();
  const [status, setStatus] = useState("open");
  const [resolving, setResolving] = useState<ReconciliationExceptionView | null>(null);
  const list = usePaged(
    (cursor, signal) =>
      api.get(
        "/v1/admin/reconciliation",
        reconciliationListResponseSchema,
        { status, cursor, limit: 25 },
        signal,
      ),
    [status],
  );
  const run = useAction(async () => {
    const to = new Date();
    const from = new Date(to.getTime() - 7 * 86_400_000);
    const result = await api.post(
      "/v1/admin/reconciliation/runs",
      reconciliationRunResponseSchema,
      {
        from: from.toISOString(),
        to: to.toISOString(),
      },
    );
    toast(
      t("finance.runDone", { matched: result.data.matched, mismatched: result.data.mismatched }),
    );
    list.reload();
  });
  return (
    <>
      <div className="row">
        <StatusFilter
          value={status}
          onChange={setStatus}
          options={["open", "resolved"]}
          prefix="reconStatus"
        />
        <Button
          onClick={() => void run.run()}
          loading={run.pending}
          data-testid="run-reconciliation"
        >
          {t("finance.runReconciliation")}
        </Button>
      </div>
      <ActionError error={run.error} />
      {list.error ? <ErrorState error={list.error} onRetry={list.reload} /> : null}
      <DataTable<ReconciliationExceptionView>
        caption={t("finance.tab.reconciliation")}
        rows={list.items}
        rowKey={(r) => r.id}
        emptyText={list.loading ? t("common.loading") : t("finance.noExceptions")}
        columns={[
          { key: "k", header: t("common.type"), render: (r) => t(`reconKind.${r.kind}`) },
          {
            key: "o",
            header: t("finance.object"),
            render: (r) => `${r.objectType} ${shortId(r.localId)}`,
          },
          {
            key: "e",
            header: t("finance.expected"),
            render: (r) => <JsonBlock value={r.expected} />,
          },
          { key: "a", header: t("finance.actual"), render: (r) => <JsonBlock value={r.actual} /> },
          {
            key: "s",
            header: t("common.status"),
            render: (r) => (
              <StatusChip tone={statusTone[r.status]}>{t(`reconStatus.${r.status}`)}</StatusChip>
            ),
          },
          {
            key: "w",
            header: t("common.when"),
            render: (r) => formatDateTime(r.createdAt, locale),
          },
          {
            key: "act",
            header: t("common.actions"),
            render: (r) =>
              r.status === "open" && can("finance_checker") ? (
                <Button variant="secondary" onClick={() => setResolving(r)}>
                  {t("finance.resolve")}
                </Button>
              ) : (
                (r.resolutionReason ?? "—")
              ),
          },
        ]}
      />
      <LoadMore hasMore={list.hasMore} loading={list.loading} onMore={() => void list.more()} />
      {resolving ? (
        <ReasonDialog
          title={t("finance.resolve")}
          confirmLabel={t("finance.resolve")}
          onConfirm={(reason) =>
            api.post(
              `/v1/admin/reconciliation/${resolving.id}/resolve`,
              reconciliationExceptionResponseSchema,
              { reason },
            )
          }
          onClose={() => setResolving(null)}
          onDone={() => {
            setResolving(null);
            list.reload();
          }}
        />
      ) : null}
    </>
  );
}

// ── Disputes ────────────────────────────────────────────────────────────────

function Disputes() {
  const { t, locale } = useI18n();
  const api = useApi();
  const { can } = useRoles();
  const [status, setStatus] = useState("");
  const [evidenceFor, setEvidenceFor] = useState<DisputeView | null>(null);
  const [resolve, setResolve] = useState<{ row: DisputeView; outcome: "won" | "lost" } | null>(
    null,
  );
  const list = usePaged(
    (cursor, signal) =>
      api.get(
        "/v1/admin/disputes",
        disputeListResponseSchema,
        { status, cursor, limit: 25 },
        signal,
      ),
    [status],
  );
  return (
    <>
      <StatusFilter
        value={status}
        onChange={setStatus}
        options={["open", "evidence_submitted", "won", "lost"]}
        prefix="disputeStatus"
      />
      <Banner tone="info">{t("finance.disputeSandbox")}</Banner>
      {list.error ? <ErrorState error={list.error} onRetry={list.reload} /> : null}
      <DataTable<DisputeView>
        caption={t("finance.tab.disputes")}
        rows={list.items}
        rowKey={(r) => r.id}
        emptyText={list.loading ? t("common.loading") : t("finance.noDisputes")}
        columns={[
          { key: "o", header: t("orders.number"), render: (r) => <bdi>{r.publicNumber}</bdi> },
          {
            key: "ref",
            header: t("finance.providerRef"),
            render: (r) => <span className="mono">{r.providerRef}</span>,
          },
          { key: "a", header: t("common.amount"), render: (r) => formatFils(r.amountFils, locale) },
          { key: "r", header: t("common.reason"), render: (r) => r.reason },
          {
            key: "s",
            header: t("common.status"),
            render: (r) => (
              <StatusChip tone={statusTone[r.status]}>{t(`disputeStatus.${r.status}`)}</StatusChip>
            ),
          },
          { key: "due", header: t("finance.due"), render: (r) => formatDateTime(r.dueAt, locale) },
          {
            key: "act",
            header: t("common.actions"),
            render: (r) => (
              <span className="row">
                {r.status === "open" && can("finance_maker") ? (
                  <Button variant="secondary" onClick={() => setEvidenceFor(r)}>
                    {t("finance.submitEvidence")}
                  </Button>
                ) : null}
                {(r.status === "open" || r.status === "evidence_submitted") &&
                can("finance_checker") ? (
                  <>
                    <Button onClick={() => setResolve({ row: r, outcome: "won" })}>
                      {t("finance.won")}
                    </Button>
                    <Button
                      variant="secondary"
                      onClick={() => setResolve({ row: r, outcome: "lost" })}
                    >
                      {t("finance.lost")}
                    </Button>
                  </>
                ) : null}
              </span>
            ),
          },
        ]}
      />
      <LoadMore hasMore={list.hasMore} loading={list.loading} onMore={() => void list.more()} />
      {evidenceFor ? (
        <EvidenceDialog
          dispute={evidenceFor}
          onClose={() => setEvidenceFor(null)}
          onDone={() => {
            setEvidenceFor(null);
            list.reload();
          }}
        />
      ) : null}
      {resolve ? (
        <ReasonDialog
          title={t(resolve.outcome === "won" ? "finance.won" : "finance.lost")}
          body={<p>{t("finance.resolveHint")}</p>}
          confirmLabel={t("common.confirm")}
          destructive={resolve.outcome === "lost"}
          onConfirm={(reason) =>
            api.post(`/v1/admin/disputes/${resolve.row.id}/resolve`, disputeResponseSchema, {
              outcome: resolve.outcome,
              reason,
            })
          }
          onClose={() => setResolve(null)}
          onDone={() => {
            setResolve(null);
            list.reload();
          }}
        />
      ) : null}
    </>
  );
}

function EvidenceDialog({
  dispute,
  onClose,
  onDone,
}: {
  dispute: DisputeView;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useI18n();
  const api = useApi();
  const toast = useToast();
  const [evidence, setEvidence] = useState("");
  const action = useAction(async () => {
    await api.post(`/v1/admin/disputes/${dispute.id}/evidence`, disputeResponseSchema, {
      evidence: evidence.trim(),
    });
    toast(t("common.saved"));
    onDone();
  });
  return (
    <Dialog
      open
      title={t("finance.submitEvidence")}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            loading={action.pending}
            disabled={evidence.trim().length < 10}
            onClick={() => void action.run()}
          >
            {t("finance.submitEvidence")}
          </Button>
        </>
      }
    >
      <TextArea
        label={t("finance.evidence")}
        hint={t("finance.evidenceHint")}
        value={evidence}
        onChange={(e) => setEvidence(e.target.value)}
        maxLength={4000}
        rows={8}
      />
      <ActionError error={action.error} />
    </Dialog>
  );
}

// ── Ledger ──────────────────────────────────────────────────────────────────

function Ledger() {
  const { t, locale } = useI18n();
  const api = useApi();
  const query = useQuery(
    async (signal) =>
      (await api.get("/v1/admin/ledger/trial-balance", trialBalanceResponseSchema, {}, signal))
        .data,
    [],
  );
  return (
    <QueryView query={query}>
      {(d) => (
        <>
          {d.balanced ? (
            <Banner tone="success">{t("finance.balanced")}</Banner>
          ) : (
            <Banner tone="error">{t("finance.unbalanced", { count: d.unbalancedJournals })}</Banner>
          )}
          <div className="stats">
            <Stat label={t("finance.totalDebit")} value={formatFils(d.totalDebitFils, locale)} />
            <Stat label={t("finance.totalCredit")} value={formatFils(d.totalCreditFils, locale)} />
          </div>
          <DataTable
            caption={t("finance.tab.ledger")}
            rows={d.accounts}
            rowKey={(r) => r.account}
            columns={[
              {
                key: "a",
                header: t("finance.account"),
                render: (r) => <span className="mono">{r.account}</span>,
              },
              {
                key: "d",
                header: t("finance.debit"),
                render: (r) => formatFils(r.debitFils, locale),
              },
              {
                key: "c",
                header: t("finance.credit"),
                render: (r) => formatFils(r.creditFils, locale),
              },
            ]}
          />
        </>
      )}
    </QueryView>
  );
}
