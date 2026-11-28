"use client";
import { merchantAnalyticsResponseSchema } from "@beans/contracts";
import {
  BarChart,
  Card,
  DataTable,
  FilterBar,
  PageHeader,
  QueryView,
  SelectField,
  Stat,
  formatDate,
  formatFils,
  useApi,
  useI18n,
  useQuery,
} from "@beans/web";
import { useState } from "react";
import { branchName, rangeFor, useBranches } from "../../../lib/data";
import { useMerchant } from "../../../lib/merchant";

/** B10: completed orders and sales per day, and best-selling products, from the API. */
export default function AnalyticsPage() {
  const { t, locale } = useI18n();
  const api = useApi();
  const { merchantId } = useMerchant();
  const branches = useBranches();
  const [preset, setPreset] = useState<"7d" | "30d">("30d");
  const [branchId, setBranchId] = useState("");
  const query = useQuery(
    async (signal) =>
      (
        await api.get(
          "/v1/merchant/analytics",
          merchantAnalyticsResponseSchema,
          { merchantId, branchId, ...rangeFor(preset) },
          signal,
        )
      ).data,
    [merchantId, preset, branchId],
    { enabled: Boolean(merchantId) },
  );
  return (
    <>
      <PageHeader title={t("analytics.title")} subtitle={t("analytics.subtitle")} />
      <FilterBar>
        <SelectField
          label={t("filter.period")}
          value={preset}
          onChange={(e) => setPreset(e.target.value as "7d" | "30d")}
          options={[
            { value: "7d", label: t("filter.7d") },
            { value: "30d", label: t("filter.30d") },
          ]}
        />
        <SelectField
          label={t("filter.branch")}
          value={branchId}
          onChange={(e) => setBranchId(e.target.value)}
          options={[
            { value: "", label: t("common.all") },
            ...(branches.data ?? []).map((b) => ({ value: b.id, label: branchName(b, locale) })),
          ]}
        />
      </FilterBar>
      <QueryView query={query}>
        {(a) => {
          const orders = a.daily.reduce((n, d) => n + d.completedOrders, 0);
          const sales = a.daily.reduce((n, d) => n + BigInt(d.grossSalesFils), 0n);
          return (
            <div className="stack">
              <div className="grid">
                <Stat label={t("dashboard.completed")} value={orders} />
                <Stat label={t("dashboard.gross")} value={formatFils(sales, locale)} />
                <Stat
                  label={t("analytics.average")}
                  value={orders ? formatFils(sales / BigInt(orders), locale) : "—"}
                />
              </div>
              <Card title={t("analytics.ordersPerDay")}>
                <BarChart
                  label={t("analytics.ordersPerDay")}
                  rows={a.daily.map((d) => ({
                    label: formatDate(d.date, locale),
                    value: d.completedOrders,
                  }))}
                />
              </Card>
              <Card title={t("analytics.salesPerDay")}>
                <BarChart
                  label={t("analytics.salesPerDay")}
                  rows={a.daily.map((d) => ({
                    label: formatDate(d.date, locale),
                    value: Number(BigInt(d.grossSalesFils)),
                  }))}
                  format={(n) => formatFils(BigInt(n), locale)}
                />
              </Card>
              <Card title={t("analytics.topProducts")}>
                <DataTable
                  caption={t("analytics.topProducts")}
                  rows={a.products}
                  rowKey={(p) => p.productId}
                  emptyText={t("analytics.noProducts")}
                  columns={[
                    { key: "name", header: t("menu.product"), render: (p) => p.name },
                    { key: "units", header: t("analytics.units"), render: (p) => p.units },
                  ]}
                />
              </Card>
            </div>
          );
        }}
      </QueryView>
    </>
  );
}
