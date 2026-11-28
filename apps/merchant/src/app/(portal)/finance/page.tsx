"use client";
import { merchantFinanceResponseSchema, merchantPayoutListResponseSchema } from "@beans/contracts";
import {
  ActionError,
  Banner,
  Button,
  Card,
  DataTable,
  FilterBar,
  PageHeader,
  QueryView,
  SelectField,
  Stat,
  StatusChip,
  formatDateTime,
  formatFils,
  useAction,
  useApi,
  useI18n,
  useQuery,
} from "@beans/web";
import { useState } from "react";
import { rangeFor } from "../../../lib/data";
import { useMerchant } from "../../../lib/merchant";

type Preset = "today" | "7d" | "30d";

/**
 * B09: sales, refunds, commission, payable balance and payout history, read from the immutable
 * journal. Sandbox figures only; the commission policy shown is the sandbox default (D02).
 */
export default function FinancePage() {
  const { t, locale } = useI18n();
  const api = useApi();
  const { merchantId } = useMerchant();
  const [preset, setPreset] = useState<Preset>("30d");
  const summary = useQuery(
    async (signal) =>
      (
        await api.get(
          "/v1/merchant/finance",
          merchantFinanceResponseSchema,
          { merchantId, ...rangeFor(preset) },
          signal,
        )
      ).data,
    [merchantId, preset],
    { enabled: Boolean(merchantId) },
  );
  const payouts = useQuery(
    async (signal) =>
      (
        await api.get(
          "/v1/merchant/finance/payouts",
          merchantPayoutListResponseSchema,
          { merchantId },
          signal,
        )
      ).data,
    [merchantId],
    { enabled: Boolean(merchantId) },
  );
  const exportCsv = useAction(async () => {
    await api.download("/v1/merchant/finance/statement", `statement-${preset}.csv`, {
      merchantId,
      ...rangeFor(preset),
    });
  });
  const money = (fils: string) => formatFils(fils, locale);
  return (
    <>
      <PageHeader
        title={t("finance.title")}
        subtitle={t("finance.subtitle")}
        actions={
          <Button
            variant="secondary"
            onClick={() => void exportCsv.run()}
            loading={exportCsv.pending}
            data-testid="export-statement"
          >
            {t("finance.export")}
          </Button>
        }
      />
      <ActionError error={exportCsv.error} />
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
      </FilterBar>
      <QueryView query={summary}>
        {(f) => (
          <div className="stack">
            {f.commission.sandbox ? (
              <Banner tone="warning">{t("finance.sandboxPolicy")}</Banner>
            ) : null}
            <div className="grid" data-testid="finance-stats">
              <Stat label={t("finance.sales")} value={money(f.salesFils)} />
              <Stat label={t("finance.refunds")} value={money(f.refundsFils)} />
              <Stat label={t("finance.commission")} value={money(f.commissionFils)} />
              <Stat
                label={t("finance.net")}
                value={money(f.netPayableFils)}
                hint={t("finance.netHint")}
              />
              <Stat
                label={t("finance.balance")}
                value={money(f.balanceFils)}
                hint={t("finance.balanceHint")}
              />
              <Stat label={t("finance.paidOut")} value={money(f.paidOutFils)} />
            </div>
            <Card title={t("finance.commissionTitle")}>
              <p>
                {f.commission.rateBasisPoints === null
                  ? t("finance.noPolicy")
                  : t(
                      f.commission.vatExcluded
                        ? "finance.commissionRuleVat"
                        : "finance.commissionRule",
                      {
                        rate: (f.commission.rateBasisPoints / 100).toString(),
                        version: f.commission.policyVersion ?? "—",
                      },
                    )}
              </p>
            </Card>
            <Card title={t("finance.transactions")}>
              {f.truncated ? <Banner tone="info">{t("finance.truncated")}</Banner> : null}
              <DataTable
                caption={t("finance.transactions")}
                rows={f.transactions}
                rowKey={(r) => `${r.kind}-${r.orderId}-${r.at}`}
                emptyText={t("finance.noTransactions")}
                columns={[
                  {
                    key: "at",
                    header: t("finance.when"),
                    render: (r) => formatDateTime(r.at, locale),
                  },
                  {
                    key: "kind",
                    header: t("finance.kind"),
                    render: (r) => (
                      <StatusChip tone={r.kind === "sale" ? "success" : "warning"}>
                        {t(`finance.kind.${r.kind}`)}
                      </StatusChip>
                    ),
                  },
                  { key: "order", header: t("orders.number"), render: (r) => r.publicNumber },
                  {
                    key: "amount",
                    header: t("finance.amount"),
                    render: (r) => money(r.amountFils),
                  },
                  {
                    key: "fee",
                    header: t("finance.commission"),
                    render: (r) => money(r.commissionFils),
                  },
                  {
                    key: "change",
                    header: t("finance.payableChange"),
                    render: (r) =>
                      r.payableChangeFils.startsWith("-")
                        ? `−${money(r.payableChangeFils.slice(1))}`
                        : money(r.payableChangeFils),
                  },
                ]}
              />
            </Card>
          </div>
        )}
      </QueryView>
      <Card title={t("finance.payouts")}>
        <p className="muted small">{t("finance.payoutsNote")}</p>
        <QueryView query={payouts}>
          {(rows) => (
            <DataTable
              caption={t("finance.payouts")}
              rows={rows}
              rowKey={(p) => p.id}
              emptyText={t("finance.noPayouts")}
              columns={[
                {
                  key: "created",
                  header: t("finance.when"),
                  render: (p) => formatDateTime(p.createdAt, locale),
                },
                {
                  key: "period",
                  header: t("finance.periodEnd"),
                  render: (p) => formatDateTime(p.periodEnd, locale),
                },
                { key: "amount", header: t("finance.amount"), render: (p) => money(p.amountFils) },
                {
                  key: "status",
                  header: t("menu.status"),
                  render: (p) => (
                    <StatusChip
                      tone={
                        p.status === "paid"
                          ? "success"
                          : p.status === "failed" || p.status === "rejected"
                            ? "error"
                            : "warning"
                      }
                    >
                      {t(`payoutStatus.${p.status}`)}
                    </StatusChip>
                  ),
                },
              ]}
            />
          )}
        </QueryView>
      </Card>
    </>
  );
}
