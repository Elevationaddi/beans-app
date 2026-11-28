"use client";
import { adminDashboardResponseSchema, citySchema } from "@beans/contracts";
import {
  Banner,
  Card,
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
import { rangeFor, useRoles, type Preset } from "../../../lib/admin";
import { NoAccess } from "../../../lib/ui";

const ALERT_LINK: Record<string, string> = {
  outbox_failed: "/audit",
  webhooks_waiting: "/finance",
  refunds_failed: "/finance",
  payouts_failed: "/finance",
  reconciliation_open: "/finance",
  orders_waiting_acceptance: "/orders",
};

/** A01: live platform overview from the API, with operational alerts. */
export default function OverviewPage() {
  const { t, locale } = useI18n();
  const api = useApi();
  const { can } = useRoles();
  const [preset, setPreset] = useState<Preset>("today");
  const [city, setCity] = useState("");
  const allowed = can("operations", "finance_maker", "finance_checker", "analyst");
  const query = useQuery(
    async (signal) =>
      (
        await api.get(
          "/v1/admin/dashboard",
          adminDashboardResponseSchema,
          { ...rangeFor(preset), city },
          signal,
        )
      ).data,
    [preset, city],
    { enabled: allowed, pollMs: 60_000 },
  );
  if (!allowed) return <NoAccess />;
  return (
    <>
      <PageHeader title={t("overview.title")} subtitle={t("overview.subtitle")} />
      <FilterBar>
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
        <SelectField
          label={t("filter.city")}
          value={city}
          onChange={(e) => setCity(e.target.value)}
          options={[
            { value: "", label: t("common.all") },
            ...citySchema.options.map((c) => ({ value: c, label: t(`city.${c}`) })),
          ]}
        />
      </FilterBar>
      <QueryView query={query}>
        {(d) => (
          <>
            {d.alerts.length > 0 ? (
              <Card title={t("overview.alerts")}>
                <ul className="stack" data-testid="alerts">
                  {d.alerts.map((a) => (
                    <li key={a.code}>
                      <Banner tone="warning">
                        <strong>{t(`alert.${a.code}`, { count: a.count })}</strong>{" "}
                        <Link href={ALERT_LINK[a.code] ?? "/overview"}>{t("common.details")}</Link>
                      </Banner>
                    </li>
                  ))}
                </ul>
              </Card>
            ) : (
              <Banner tone="success">{t("overview.noAlerts")}</Banner>
            )}
            <div className="stats" data-testid="overview-stats">
              <Stat label={t("overview.gmv")} value={formatFils(d.gmvFils, locale)} />
              <Stat label={t("overview.refunded")} value={formatFils(d.refundedFils, locale)} />
              <Stat label={t("overview.paidOrders")} value={d.paidOrders} />
              <Stat label={t("overview.completedOrders")} value={d.completedOrders} />
              <Stat label={t("overview.activeShops")} value={d.activeShops} />
              <Stat label={t("overview.pendingApprovals")} value={d.pendingApprovals} />
              <Stat label={t("overview.openTickets")} value={d.openTickets} />
              <Stat label={t("overview.openCancellations")} value={d.openCancellationRequests} />
            </div>
            <p className="muted small">{t("overview.definitions")}</p>
          </>
        )}
      </QueryView>
    </>
  );
}
