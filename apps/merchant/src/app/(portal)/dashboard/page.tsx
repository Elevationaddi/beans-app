"use client";
import { merchantDashboardResponseSchema } from "@beans/contracts";
import {
  EmptyState,
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
import Link from "next/link";
import { useState } from "react";
import { branchName, rangeFor, useBranches } from "../../../lib/data";
import { useMerchant } from "../../../lib/merchant";

export default function DashboardPage() {
  const { t, locale } = useI18n();
  const api = useApi();
  const { merchantId, current } = useMerchant();
  const branches = useBranches();
  const [preset, setPreset] = useState<"today" | "7d" | "30d">("today");
  const [branchId, setBranchId] = useState("");
  const query = useQuery(
    async (signal) => {
      const range = rangeFor(preset);
      return (
        await api.get(
          "/v1/merchant/dashboard",
          merchantDashboardResponseSchema,
          { merchantId, branchId, ...range },
          signal,
        )
      ).data;
    },
    [merchantId, preset, branchId],
    { enabled: Boolean(merchantId), pollMs: 30_000 },
  );
  if (!current) {
    return (
      <>
        <PageHeader title={t("dashboard.title")} />
        <EmptyState
          title={t("dashboard.noBusiness")}
          body={t("dashboard.noBusinessBody")}
          action={
            <Link className="btn btn-primary" href="/onboarding">
              {t("nav.onboarding")}
            </Link>
          }
        />
      </>
    );
  }
  return (
    <>
      <PageHeader title={t("dashboard.title")} subtitle={current.brandName} />
      <FilterBar>
        <SelectField
          label={t("filter.period")}
          value={preset}
          onChange={(e) => setPreset(e.target.value as typeof preset)}
          options={[
            { value: "today", label: t("filter.today") },
            { value: "7d", label: t("filter.7d") },
            { value: "30d", label: t("filter.30d") },
          ]}
          data-testid="dashboard-period"
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
        {(d) => (
          <div className="stack">
            <div className="grid">
              <Stat label={t("dashboard.paidOrders")} value={d.paidOrders} />
              <Stat label={t("dashboard.completed")} value={d.completedOrders} />
              <Stat label={t("dashboard.gross")} value={formatFils(d.grossSalesFils, locale)} />
              <Stat label={t("dashboard.refunded")} value={formatFils(d.refundedFils, locale)} />
              <Stat
                label={t("dashboard.net")}
                value={formatFils(d.netSalesFils, locale)}
                hint={t("dashboard.netHint")}
              />
              <Stat
                label={t("dashboard.prep")}
                value={
                  d.averagePrepSeconds === null
                    ? "—"
                    : t("dashboard.minutes", { n: Math.round(d.averagePrepSeconds / 60) })
                }
              />
              <Stat label={t("dashboard.rejected")} value={d.rejectedOrders} />
              <Stat label={t("dashboard.cancelled")} value={d.cancelledOrders} />
            </div>
            <h2>{t("dashboard.liveQueue")}</h2>
            <div className="grid" data-testid="live-queue">
              <Stat label={t("status.received")} value={d.liveQueue.received} />
              <Stat label={t("status.accepted")} value={d.liveQueue.accepted} />
              <Stat label={t("status.preparing")} value={d.liveQueue.preparing} />
              <Stat label={t("status.ready")} value={d.liveQueue.ready} />
            </div>
            <p className="muted small">{t("dashboard.fundsNote")}</p>
          </div>
        )}
      </QueryView>
    </>
  );
}
