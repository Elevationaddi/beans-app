"use client";
import {
  adminGiftListResponseSchema,
  promotionListResponseSchema,
  promotionResponseSchema,
  type Promotion,
} from "@beans/contracts";
import {
  Banner,
  Button,
  DataTable,
  ErrorState,
  FilterBar,
  LoadMore,
  PageHeader,
  SelectField,
  StatusChip,
  Tabs,
  formatDate,
  formatDateTime,
  formatFils,
  useApi,
  useI18n,
  usePaged,
  type Tone,
} from "@beans/web";
import { useState } from "react";
import { localized, useRoles } from "../../../lib/admin";
import { NoAccess, ReasonDialog } from "../../../lib/ui";

const promoTone: Record<Promotion["status"], Tone> = {
  draft: "neutral",
  pending_review: "info",
  approved: "success",
  rejected: "error",
  paused: "warning",
  ended: "neutral",
};

/**
 * A07: merchant promotions wait here for review (marketing approves or rejects with a reason
 * the merchant sees), and every sandbox gift is listed for support. Nothing here moves money.
 */
export default function PromotionsPage() {
  const { t } = useI18n();
  const { can } = useRoles();
  const [tab, setTab] = useState<"promotions" | "gifts">("promotions");
  if (!can("marketing", "operations")) return <NoAccess />;
  return (
    <>
      <PageHeader title={t("promo.title")} subtitle={t("promo.subtitle")} />
      <Banner tone="warning">{t("promo.sandbox")}</Banner>
      <Tabs
        label={t("promo.title")}
        value={tab}
        onChange={setTab}
        tabs={[
          { value: "promotions", label: t("promo.promotions") },
          { value: "gifts", label: t("promo.gifts") },
        ]}
      />
      {tab === "promotions" ? <PromotionQueue /> : <Gifts />}
    </>
  );
}

function discountText(
  p: Promotion,
  locale: "en" | "ar",
  t: (k: string, v?: Record<string, string | number>) => string,
) {
  if (p.kind === "percent") {
    const pct = (p.percentBasisPoints ?? 0) / 100;
    return p.maxDiscountFils
      ? t("promo.percentUpTo", { pct, max: formatFils(p.maxDiscountFils, locale) })
      : t("promo.percentOff", { pct });
  }
  return t("promo.amountOff", { amount: formatFils(p.amountFils ?? "0", locale) });
}

function PromotionQueue() {
  const { t, locale } = useI18n();
  const api = useApi();
  const { can } = useRoles();
  const [status, setStatus] = useState<string>("pending_review");
  const [deciding, setDeciding] = useState<{ p: Promotion; decision: "approve" | "reject" } | null>(
    null,
  );
  const list = usePaged(
    (cursor, signal) =>
      api.get(
        "/v1/admin/promotions",
        promotionListResponseSchema,
        { status: status || undefined, cursor, limit: 25 },
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
            ...(
              ["pending_review", "approved", "rejected", "paused", "ended", "draft"] as const
            ).map((s) => ({ value: s, label: t(`promoStatus.${s}`) })),
          ]}
          data-testid="promo-status"
        />
      </FilterBar>
      {list.error ? <ErrorState error={list.error} onRetry={list.reload} /> : null}
      <DataTable<Promotion>
        caption={t("promo.promotions")}
        rows={list.items}
        rowKey={(p) => p.id}
        emptyText={list.loading ? t("common.loading") : t("promo.empty")}
        columns={[
          {
            key: "code",
            header: t("promo.code"),
            render: (p) => (
              <>
                <code>{p.code}</code>
                <p className="muted small">{localized(p.names, locale)}</p>
              </>
            ),
          },
          { key: "shop", header: t("orders.shop"), render: (p) => p.brandName },
          {
            key: "terms",
            header: t("promo.terms"),
            render: (p) => (
              <>
                {discountText(p, locale, t)}
                <p className="muted small">
                  {t("promo.minimum", { amount: formatFils(p.minSubtotalFils, locale) })} ·{" "}
                  {p.maxRedemptions
                    ? t("promo.limit", { n: p.maxRedemptions, per: p.perCustomerLimit })
                    : t("promo.perCustomer", { per: p.perCustomerLimit })}
                </p>
              </>
            ),
          },
          {
            key: "dates",
            header: t("promo.dates"),
            render: (p) => `${formatDate(p.startsAt, locale)} – ${formatDate(p.endsAt, locale)}`,
          },
          {
            key: "status",
            header: t("common.status"),
            render: (p) => (
              <>
                <StatusChip tone={promoTone[p.status]}>{t(`promoStatus.${p.status}`)}</StatusChip>
                {p.reviewNote ? <p className="muted small">{p.reviewNote}</p> : null}
              </>
            ),
          },
          {
            key: "act",
            header: t("common.actions"),
            render: (p) =>
              p.status === "pending_review" && can("marketing") ? (
                <div className="row">
                  <Button
                    onClick={() => setDeciding({ p, decision: "approve" })}
                    data-testid={`approve-${p.code}`}
                  >
                    {t("promo.approve")}
                  </Button>
                  <Button
                    variant="destructive"
                    onClick={() => setDeciding({ p, decision: "reject" })}
                    data-testid={`reject-${p.code}`}
                  >
                    {t("promo.reject")}
                  </Button>
                </div>
              ) : null,
          },
        ]}
      />
      <LoadMore hasMore={list.hasMore} loading={list.loading} onMore={() => void list.more()} />
      {deciding ? (
        <ReasonDialog
          title={t(deciding.decision === "approve" ? "promo.approve" : "promo.reject")}
          body={
            <p>
              {t(deciding.decision === "approve" ? "promo.approveHint" : "promo.rejectHint", {
                code: deciding.p.code,
              })}
            </p>
          }
          confirmLabel={t(deciding.decision === "approve" ? "promo.approve" : "promo.reject")}
          destructive={deciding.decision === "reject"}
          onConfirm={(reason) =>
            api.post(`/v1/admin/promotions/${deciding.p.id}/review`, promotionResponseSchema, {
              decision: deciding.decision,
              reason,
              expectedVersion: deciding.p.version,
            })
          }
          onClose={() => setDeciding(null)}
          onDone={() => {
            setDeciding(null);
            list.reload();
          }}
        />
      ) : null}
    </>
  );
}

function Gifts() {
  const { t, locale } = useI18n();
  const api = useApi();
  const [status, setStatus] = useState("");
  const list = usePaged(
    (cursor, signal) =>
      api.get(
        "/v1/admin/gifts",
        adminGiftListResponseSchema,
        { status: status || undefined, cursor, limit: 25 },
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
            ...(["issued", "claimed", "reserved", "redeemed", "expired"] as const).map((s) => ({
              value: s,
              label: t(`giftStatus.${s}`),
            })),
          ]}
        />
      </FilterBar>
      {list.error ? <ErrorState error={list.error} onRetry={list.reload} /> : null}
      <DataTable
        caption={t("promo.gifts")}
        rows={list.items}
        rowKey={(g) => g.id}
        emptyText={list.loading ? t("common.loading") : t("promo.noGifts")}
        columns={[
          {
            key: "p",
            header: t("promo.product"),
            render: (g) => (
              <>
                <strong>{localized(g.productNames, locale)}</strong>
                <p className="muted small">{g.brandName}</p>
              </>
            ),
          },
          { key: "v", header: t("promo.value"), render: (g) => formatFils(g.valueFils, locale) },
          {
            key: "s",
            header: t("common.status"),
            render: (g) => <StatusChip tone="info">{t(`giftStatus.${g.status}`)}</StatusChip>,
          },
          {
            key: "w",
            header: t("promo.people"),
            render: (g) => (
              <span className="small">
                {t("promo.from", { id: g.purchaserId.slice(0, 8) })}
                {g.recipientId ? ` → ${t("promo.to", { id: g.recipientId.slice(0, 8) })}` : ""}
              </span>
            ),
          },
          {
            key: "d",
            header: t("promo.created"),
            render: (g) => formatDateTime(g.createdAt, locale),
          },
          { key: "e", header: t("promo.expires"), render: (g) => formatDate(g.expiresAt, locale) },
        ]}
      />
      <LoadMore hasMore={list.hasMore} loading={list.loading} onMore={() => void list.more()} />
    </>
  );
}
