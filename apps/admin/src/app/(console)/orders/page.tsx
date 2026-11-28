"use client";
import {
  adminCancelOrderResponseSchema,
  adminCancellationListResponseSchema,
  adminCancellationResponseSchema,
  adminOrderListResponseSchema,
  adminOrderResponseSchema,
  orderStatusSchema,
  type AdminCancellationView,
  type AdminOrder,
} from "@beans/contracts";
import {
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
  Tabs,
  TextField,
  formatDateTime,
  formatFils,
  useApi,
  useI18n,
  usePaged,
  useQuery,
} from "@beans/web";
import { useState } from "react";
import { orderTone, shortId, statusTone, useRoles } from "../../../lib/admin";
import { NoAccess, ReasonDialog } from "../../../lib/ui";

const TERMINAL = ["completed", "cancelled", "rejected", "payment_failed"];

/** A04: monitor orders across all shops, inspect one, cancel, and handle cancellation requests. */
export default function OrdersPage() {
  const { t } = useI18n();
  const { can } = useRoles();
  const [tab, setTab] = useState<"orders" | "cancellations">("orders");
  if (!can("operations", "support", "finance_maker", "finance_checker")) return <NoAccess />;
  return (
    <>
      <PageHeader title={t("orders.title")} subtitle={t("orders.subtitle")} />
      <Tabs
        label={t("orders.title")}
        value={tab}
        onChange={setTab}
        tabs={[
          { value: "orders", label: t("orders.all") },
          ...(can("operations", "support")
            ? [{ value: "cancellations" as const, label: t("orders.cancellations") }]
            : []),
        ]}
      />
      {tab === "orders" ? <OrderList /> : <Cancellations />}
    </>
  );
}

function OrderList() {
  const { t, locale } = useI18n();
  const api = useApi();
  const [status, setStatus] = useState("");
  const [numberInput, setNumberInput] = useState("");
  const [number, setNumber] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const list = usePaged(
    (cursor, signal) =>
      api.get(
        "/v1/admin/orders",
        adminOrderListResponseSchema,
        { status, number, cursor, limit: 25 },
        signal,
      ),
    [status, number],
  );
  return (
    <>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setNumber(numberInput.trim().length >= 4 ? numberInput.trim() : "");
        }}
      >
        <FilterBar>
          <SelectField
            label={t("common.status")}
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            data-testid="order-status-filter"
            options={[
              { value: "", label: t("common.all") },
              ...orderStatusSchema.options.map((s) => ({
                value: s,
                label: t(`orderStatus.${s}`),
              })),
            ]}
          />
          <TextField
            label={t("orders.number")}
            value={numberInput}
            onChange={(e) => setNumberInput(e.target.value)}
          />
          <Button type="submit" variant="secondary">
            {t("common.search")}
          </Button>
          <Button variant="ghost" onClick={list.reload}>
            {t("common.refresh")}
          </Button>
        </FilterBar>
      </form>
      {list.error ? <ErrorState error={list.error} onRetry={list.reload} /> : null}
      <DataTable<AdminOrder>
        caption={t("orders.title")}
        rows={list.items}
        rowKey={(r) => r.id}
        onRowClick={(r) => setOpenId(r.id)}
        emptyText={list.loading ? t("common.loading") : t("orders.empty")}
        columns={[
          { key: "n", header: t("orders.number"), render: (r) => <bdi>{r.publicNumber}</bdi> },
          {
            key: "shop",
            header: t("orders.shop"),
            render: (r) => `${r.brandName} · ${r.branchName}`,
          },
          {
            key: "s",
            header: t("common.status"),
            render: (r) => (
              <span className="row">
                <StatusChip tone={orderTone[r.status]}>{t(`orderStatus.${r.status}`)}</StatusChip>
                {r.late ? <StatusChip tone="error">{t("orders.late")}</StatusChip> : null}
              </span>
            ),
          },
          { key: "mode", header: t("orders.mode"), render: (r) => t(`mode.${r.mode}`) },
          { key: "tot", header: t("orders.total"), render: (r) => formatFils(r.totalFils, locale) },
          {
            key: "at",
            header: t("common.when"),
            render: (r) => formatDateTime(r.createdAt, locale),
          },
        ]}
      />
      <LoadMore hasMore={list.hasMore} loading={list.loading} onMore={() => void list.more()} />
      {openId ? (
        <OrderDialog id={openId} onClose={() => setOpenId(null)} onChanged={list.reload} />
      ) : null}
    </>
  );
}

function OrderDialog({
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
  const [cancelling, setCancelling] = useState(false);
  const detail = useQuery(
    async (signal) =>
      (await api.get(`/v1/admin/orders/${id}`, adminOrderResponseSchema, {}, signal)).data,
    [id],
  );
  const o = detail.data;
  return (
    <Dialog
      open
      wide
      title={o ? t("orders.dialogTitle", { number: o.publicNumber }) : t("orders.title")}
      onClose={onClose}
    >
      {detail.error && !o ? <ErrorState error={detail.error} onRetry={detail.reload} /> : null}
      {!o && !detail.error ? <Loading /> : null}
      {o ? (
        <>
          <DefinitionList
            items={[
              [t("orders.shop"), `${o.brandName} · ${o.branchName}`],
              [
                t("common.status"),
                <StatusChip key="s" tone={orderTone[o.status]}>
                  {t(`orderStatus.${o.status}`)}
                </StatusChip>,
              ],
              [t("orders.mode"), t(`mode.${o.mode}`)],
              [t("orders.total"), formatFils(o.totalFils, locale)],
              [t("orders.customer"), shortId(o.customerId)],
              [t("orders.acceptBy"), formatDateTime(o.acceptBy, locale)],
              [t("orders.eta"), formatDateTime(o.etaAt, locale)],
            ]}
          />
          <h3>{t("orders.items")}</h3>
          <ul>
            {o.items.map((i, n) => (
              <li key={n}>
                {i.quantity} × {i.name}
                {i.options.length ? <span className="muted"> ({i.options.join(", ")})</span> : null}
              </li>
            ))}
          </ul>
          <h3>{t("orders.timeline")}</h3>
          <ol className="stack" data-testid="order-timeline">
            {o.events.map((e, n) => (
              <li key={n}>
                <span className="muted small">{formatDateTime(e.at, locale)}</span>{" "}
                {e.toStatus ? t(`orderStatus.${e.toStatus}`) : e.type}
                {e.actorRole ? <span className="muted small"> · {e.actorRole}</span> : null}
              </li>
            ))}
          </ol>
          <h3>{t("orders.payments")}</h3>
          <DataTable
            caption={t("orders.payments")}
            rows={[
              ...o.payments.map((p) => ({ ...p, type: t("orders.payment") })),
              ...o.refunds.map((r) => ({ ...r, type: t("orders.refund"), provider: "" })),
            ]}
            rowKey={(r) => r.id}
            emptyText={t("orders.noPayments")}
            columns={[
              { key: "t", header: t("common.type"), render: (r) => r.type },
              {
                key: "s",
                header: t("common.status"),
                render: (r) => <StatusChip tone={statusTone[r.status]}>{r.status}</StatusChip>,
              },
              {
                key: "a",
                header: t("common.amount"),
                render: (r) => formatFils(r.amountFils, locale),
              },
              { key: "p", header: t("orders.provider"), render: (r) => r.provider || "—" },
              {
                key: "w",
                header: t("common.when"),
                render: (r) => formatDateTime(r.createdAt, locale),
              },
            ]}
          />
          {can("operations") && !TERMINAL.includes(o.status) ? (
            <div className="row" style={{ marginBlockStart: 16 }}>
              <Button
                variant="destructive"
                onClick={() => setCancelling(true)}
                data-testid="admin-cancel"
              >
                {t("orders.cancel")}
              </Button>
            </div>
          ) : null}
        </>
      ) : null}
      {cancelling && o ? (
        <ReasonDialog
          title={t("orders.cancel")}
          body={<p>{t("orders.cancelHint")}</p>}
          confirmLabel={t("orders.cancel")}
          destructive
          onConfirm={(reason) =>
            api.post(`/v1/admin/orders/${id}/cancel`, adminCancelOrderResponseSchema, {
              reason,
              expectedVersion: o.version,
            })
          }
          onClose={() => setCancelling(false)}
          onDone={() => {
            setCancelling(false);
            detail.reload();
            onChanged();
          }}
        />
      ) : null}
    </Dialog>
  );
}

function Cancellations() {
  const { t, locale } = useI18n();
  const api = useApi();
  const { can } = useRoles();
  const [status, setStatus] = useState("open");
  const [action, setAction] = useState<{
    row: AdminCancellationView;
    kind: "approve" | "decline";
  } | null>(null);
  const list = usePaged(
    (cursor, signal) =>
      api.get(
        "/v1/admin/cancellation-requests",
        adminCancellationListResponseSchema,
        { status, cursor, limit: 25 },
        signal,
      ),
    [status],
  );
  return (
    <>
      <FilterBar>
        <SelectField
          label={t("common.status")}
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          options={[
            { value: "", label: t("common.all") },
            ...["open", "approved", "declined"].map((s) => ({
              value: s,
              label: t(`cancelStatus.${s}`),
            })),
          ]}
        />
      </FilterBar>
      {list.error ? <ErrorState error={list.error} onRetry={list.reload} /> : null}
      <DataTable<AdminCancellationView>
        caption={t("orders.cancellations")}
        rows={list.items}
        rowKey={(r) => r.id}
        emptyText={list.loading ? t("common.loading") : t("orders.noCancellations")}
        columns={[
          { key: "n", header: t("orders.number"), render: (r) => <bdi>{r.publicNumber}</bdi> },
          { key: "reason", header: t("common.reason"), render: (r) => r.reason },
          {
            key: "os",
            header: t("orders.statusWhenAsked"),
            render: (r) => t(`orderStatus.${r.orderStatus}`),
          },
          {
            key: "s",
            header: t("common.status"),
            render: (r) => (
              <StatusChip tone={statusTone[r.status]}>{t(`cancelStatus.${r.status}`)}</StatusChip>
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
              r.status === "open" && can("operations") ? (
                <span className="row">
                  <Button onClick={() => setAction({ row: r, kind: "approve" })}>
                    {t("orders.approveCancel")}
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() => setAction({ row: r, kind: "decline" })}
                  >
                    {t("orders.decline")}
                  </Button>
                </span>
              ) : (
                (r.resolutionReason ?? "—")
              ),
          },
        ]}
      />
      <LoadMore hasMore={list.hasMore} loading={list.loading} onMore={() => void list.more()} />
      {action ? (
        <ReasonDialog
          title={t(action.kind === "approve" ? "orders.approveCancel" : "orders.decline")}
          body={<p>{t(action.kind === "approve" ? "orders.cancelHint" : "orders.declineHint")}</p>}
          confirmLabel={t("common.confirm")}
          destructive={action.kind === "approve"}
          onConfirm={async (reason) => {
            if (action.kind === "decline") {
              return api.post(
                `/v1/admin/cancellation-requests/${action.row.id}/decline`,
                adminCancellationResponseSchema,
                { reason },
              );
            }
            // Approving means cancelling the order at its current version.
            const order = await api.get(
              `/v1/admin/orders/${action.row.orderId}`,
              adminOrderResponseSchema,
            );
            return api.post(
              `/v1/admin/orders/${action.row.orderId}/cancel`,
              adminCancelOrderResponseSchema,
              { reason, expectedVersion: order.data.version },
            );
          }}
          onClose={() => setAction(null)}
          onDone={() => {
            setAction(null);
            list.reload();
          }}
        />
      ) : null}
    </>
  );
}
