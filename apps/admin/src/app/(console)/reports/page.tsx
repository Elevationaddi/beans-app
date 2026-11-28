"use client";
import { adminReportResponseSchema, type AdminReportQuery } from "@beans/contracts";
import {
  BarChart,
  DataTable,
  FilterBar,
  PageHeader,
  QueryView,
  SelectField,
  Stat,
  formatFils,
  useApi,
  useI18n,
  useQuery,
} from "@beans/web";
import { useState } from "react";
import { rangeFor, useRoles, type Preset } from "../../../lib/admin";
import { NoAccess } from "../../../lib/ui";

type Report = AdminReportQuery["report"];

/** A08: aggregate reports per merchant with no personal data. Each view is audited. */
export default function ReportsPage() {
  const { t, locale } = useI18n();
  const api = useApi();
  const { can } = useRoles();
  const allowed = can("operations", "finance_maker", "finance_checker", "analyst");
  const [report, setReport] = useState<Report>("orders_by_merchant");
  const [preset, setPreset] = useState<Preset>("30d");
  const query = useQuery(
    async (signal) =>
      (
        await api.get(
          "/v1/admin/reports",
          adminReportResponseSchema,
          { report, ...rangeFor(preset) },
          signal,
        )
      ).data,
    [report, preset],
    { enabled: allowed },
  );
  if (!allowed) return <NoAccess />;
  return (
    <>
      <PageHeader title={t("reports.title")} subtitle={t("reports.subtitle")} />
      <FilterBar>
        <SelectField
          label={t("reports.report")}
          value={report}
          onChange={(e) => setReport(e.target.value as Report)}
          options={[
            { value: "orders_by_merchant", label: t("reports.orders_by_merchant") },
            { value: "refunds_by_merchant", label: t("reports.refunds_by_merchant") },
          ]}
        />
        <SelectField
          label={t("filter.period")}
          value={preset}
          onChange={(e) => setPreset(e.target.value as Preset)}
          options={[
            { value: "today", label: t("filter.today") },
            { value: "7d", label: t("filter.7d") },
            { value: "30d", label: t("filter.30d") },
          ]}
        />
      </FilterBar>
      <QueryView query={query}>
        {(d) => (
          <>
            <div className="stats">
              <Stat label={t("reports.count")} value={d.totals.count} />
              <Stat label={t("common.amount")} value={formatFils(d.totals.amountFils, locale)} />
            </div>
            {d.rows.length > 0 ? (
              <BarChart
                label={t(`reports.${d.report}`)}
                // Bar length only; amounts shown are formatted from integer fils.
                rows={d.rows.map((r) => ({ label: r.brandName, value: Number(r.amountFils) }))}
                format={(n) => formatFils(String(n), locale)}
              />
            ) : null}
            <DataTable
              caption={t(`reports.${d.report}`)}
              rows={d.rows}
              rowKey={(r) => r.merchantId}
              emptyText={t("reports.empty")}
              columns={[
                { key: "m", header: t("orders.shop"), render: (r) => r.brandName },
                { key: "c", header: t("reports.count"), render: (r) => r.count },
                {
                  key: "a",
                  header: t("common.amount"),
                  render: (r) => formatFils(r.amountFils, locale),
                },
              ]}
            />
          </>
        )}
      </QueryView>
    </>
  );
}
