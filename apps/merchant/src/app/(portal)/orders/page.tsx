"use client";
import { merchantOrderListResponseSchema, type MerchantOrder } from "@beans/contracts";
import {
  Banner,
  DataTable,
  EmptyState,
  FilterBar,
  LoadMore,
  PageHeader,
  QueryView,
  SelectField,
  StatusChip,
  Tabs,
  formatDateTime,
  useApi,
  useEventStream,
  useI18n,
  usePaged,
  useQuery,
} from "@beans/web";
import { useState } from "react";
import { branchName, orderTone, useBranches } from "../../../lib/data";
import { OrderCard } from "../../../lib/orders";

type Tab = "incoming" | "active" | "scheduled" | "completed" | "cancelled";

/** B06: incoming, active, scheduled, completed and cancelled orders for one branch, live. */
export default function OrdersPage() {
  const { t, locale } = useI18n();
  const api = useApi();
  const branches = useBranches();
  const [chosenBranch, setBranchId] = useState("");
  // Until someone picks a branch, show the first one they can see.
  const branchId = chosenBranch || branches.data?.[0]?.id || "";
  const [tab, setTab] = useState<Tab>("incoming");
  const live = useQuery(
    async (signal) =>
      (
        await api.get(
          "/v1/merchant/orders",
          merchantOrderListResponseSchema,
          { branchId, limit: 100 },
          signal,
        )
      ).data,
    [branchId],
    { enabled: Boolean(branchId), pollMs: 60_000 },
  );
  const stream = useEventStream(
    branchId ? `/v1/merchant/branches/${branchId}/order-events` : null,
    () => live.reload(),
    live.reload,
  );
  const all = live.data ?? [];
  const incoming = all.filter((o) => o.status === "received");
  const active = all.filter((o) => o.status !== "received");
  const scheduled = all.filter((o) => !o.asap);
  const shown = tab === "incoming" ? incoming : tab === "active" ? active : scheduled;
  return (
    <>
      <PageHeader title={t("orders.title")} subtitle={t(`stream.${stream}`)} />
      <FilterBar>
        <SelectField
          label={t("filter.branch")}
          value={branchId}
          onChange={(e) => setBranchId(e.target.value)}
          options={(branches.data ?? []).map((b) => ({
            value: b.id,
            label: branchName(b, locale),
          }))}
          data-testid="orders-branch"
        />
      </FilterBar>
      {stream !== "live" ? <Banner tone="warning">{t("stream.notLive")}</Banner> : null}
      <Tabs
        label={t("orders.title")}
        value={tab}
        onChange={setTab}
        tabs={[
          { value: "incoming", label: t("orders.incoming"), count: incoming.length },
          { value: "active", label: t("orders.active"), count: active.length },
          { value: "scheduled", label: t("orders.scheduled"), count: scheduled.length },
          { value: "completed", label: t("orders.completed") },
          { value: "cancelled", label: t("orders.cancelled") },
        ]}
      />
      {tab === "completed" || tab === "cancelled" ? (
        branchId ? (
          <History
            branchId={branchId}
            statuses={tab === "completed" ? ["completed"] : ["rejected", "cancelled"]}
          />
        ) : null
      ) : (
        <QueryView query={live}>
          {() =>
            shown.length === 0 ? (
              <EmptyState title={t(`orders.empty.${tab}`)} />
            ) : (
              <div className="order-grid">
                {shown.map((o) => (
                  <OrderCard key={o.id} order={o} onChanged={live.reload} />
                ))}
              </div>
            )
          }
        </QueryView>
      )}
    </>
  );
}

function History({
  branchId,
  statuses,
}: {
  branchId: string;
  statuses: MerchantOrder["status"][];
}) {
  const { t, locale } = useI18n();
  const api = useApi();
  const [chosenStatus, setStatus] = useState(statuses[0]!);
  // A tab change brings a different status list; fall back to its first status.
  const status = statuses.includes(chosenStatus) ? chosenStatus : statuses[0]!;
  const list = usePaged(
    (cursor, signal) =>
      api.get(
        "/v1/merchant/orders",
        merchantOrderListResponseSchema,
        { branchId, status, cursor, limit: 25 },
        signal,
      ),
    [branchId, status],
  );
  return (
    <>
      {statuses.length > 1 ? (
        <FilterBar>
          <SelectField
            label={t("menu.status")}
            value={status}
            onChange={(e) => setStatus(e.target.value as MerchantOrder["status"])}
            options={statuses.map((s) => ({ value: s, label: t(`status.${s}`) }))}
          />
        </FilterBar>
      ) : null}
      <QueryView
        query={{
          data: list.loading && list.items.length === 0 ? undefined : list.items,
          error: list.error,
          loading: list.loading,
          reload: list.reload,
        }}
      >
        {(rows) => (
          <DataTable
            caption={t("orders.title")}
            rows={rows}
            rowKey={(o) => o.id}
            emptyText={t("orders.noHistory")}
            columns={[
              { key: "n", header: t("orders.number"), render: (o) => `#${o.publicNumber}` },
              {
                key: "when",
                header: t("orders.placed"),
                render: (o) => formatDateTime(o.createdAt, locale),
              },
              { key: "mode", header: t("branch.modes"), render: (o) => t(`mode.${o.mode}`) },
              {
                key: "items",
                header: t("orders.items"),
                render: (o) =>
                  o.items.map((i) => `${i.quantity}× ${i.names[locale] ?? i.names.en}`).join(", "),
              },
              {
                key: "status",
                header: t("menu.status"),
                render: (o) => (
                  <StatusChip tone={orderTone[o.status]}>{t(`status.${o.status}`)}</StatusChip>
                ),
              },
            ]}
          />
        )}
      </QueryView>
      <LoadMore hasMore={list.hasMore} loading={list.loading} onMore={() => void list.more()} />
    </>
  );
}
