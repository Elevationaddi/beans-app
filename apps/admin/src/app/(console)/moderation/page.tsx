"use client";
import {
  adminProductListResponseSchema,
  adminProductResponseSchema,
  type AdminProduct,
} from "@beans/contracts";
import {
  Button,
  DataTable,
  ErrorState,
  FilterBar,
  LoadMore,
  PageHeader,
  SelectField,
  StatusChip,
  TextField,
  formatFils,
  useApi,
  useI18n,
  usePaged,
} from "@beans/web";
import { useState } from "react";
import { localized, useRoles } from "../../../lib/admin";
import { NoAccess, ReasonDialog } from "../../../lib/ui";

/**
 * Menu moderation: hide a product that breaks platform rules from every customer menu, with a
 * reason the merchant can see, and restore it later. The merchant's own data is not changed.
 */
export default function ModerationPage() {
  const { t, locale } = useI18n();
  const api = useApi();
  const { can } = useRoles();
  const [hidden, setHidden] = useState("");
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  const [acting, setActing] = useState<AdminProduct | null>(null);
  const list = usePaged(
    (cursor, signal) =>
      api.get(
        "/v1/admin/products",
        adminProductListResponseSchema,
        { hidden, q, cursor, limit: 25 },
        signal,
      ),
    [hidden, q],
  );
  if (!can("operations", "marketing")) return <NoAccess />;
  return (
    <>
      <PageHeader title={t("moderation.title")} subtitle={t("moderation.subtitle")} />
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setQ(search.trim().length >= 2 ? search.trim() : "");
        }}
      >
        <FilterBar>
          <TextField
            label={t("common.search")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <SelectField
            label={t("moderation.visibility")}
            value={hidden}
            onChange={(e) => setHidden(e.target.value)}
            options={[
              { value: "", label: t("common.all") },
              { value: "false", label: t("moderation.visible") },
              { value: "true", label: t("moderation.hidden") },
            ]}
          />
          <Button type="submit" variant="secondary">
            {t("common.search")}
          </Button>
        </FilterBar>
      </form>
      {list.error ? <ErrorState error={list.error} onRetry={list.reload} /> : null}
      <DataTable<AdminProduct>
        caption={t("moderation.title")}
        rows={list.items}
        rowKey={(r) => r.id}
        emptyText={list.loading ? t("common.loading") : t("moderation.empty")}
        columns={[
          {
            key: "n",
            header: t("common.name"),
            render: (r) => (
              <>
                <strong>{localized(r.names, locale)}</strong>
                {r.descriptions.en ? (
                  <p className="muted small">
                    {localized({ en: r.descriptions.en, ar: r.descriptions.ar }, locale)}
                  </p>
                ) : null}
              </>
            ),
          },
          { key: "m", header: t("orders.shop"), render: (r) => r.brandName },
          {
            key: "p",
            header: t("moderation.price"),
            render: (r) => formatFils(r.baseFils, locale),
          },
          { key: "st", header: t("common.status"), render: (r) => t(`productStatus.${r.status}`) },
          {
            key: "h",
            header: t("moderation.visibility"),
            render: (r) =>
              r.hidden ? (
                <span>
                  <StatusChip tone="error">{t("moderation.hidden")}</StatusChip>
                  {r.moderationNote ? <p className="muted small">{r.moderationNote}</p> : null}
                </span>
              ) : (
                <StatusChip tone="success">{t("moderation.visible")}</StatusChip>
              ),
          },
          {
            key: "act",
            header: t("common.actions"),
            render: (r) =>
              can("operations") ? (
                <Button
                  variant={r.hidden ? "secondary" : "destructive"}
                  onClick={() => setActing(r)}
                  data-testid={`moderate-${r.id}`}
                >
                  {t(r.hidden ? "moderation.restore" : "moderation.hide")}
                </Button>
              ) : null,
          },
        ]}
      />
      <LoadMore hasMore={list.hasMore} loading={list.loading} onMore={() => void list.more()} />
      {acting ? (
        <ReasonDialog
          title={t(acting.hidden ? "moderation.restore" : "moderation.hide")}
          body={<p>{t(acting.hidden ? "moderation.restoreHint" : "moderation.hideHint")}</p>}
          confirmLabel={t("common.confirm")}
          destructive={!acting.hidden}
          onConfirm={(reason) =>
            api.post(`/v1/admin/products/${acting.id}/moderation`, adminProductResponseSchema, {
              hidden: !acting.hidden,
              reason,
            })
          }
          onClose={() => setActing(null)}
          onDone={() => {
            setActing(null);
            list.reload();
          }}
        />
      ) : null}
    </>
  );
}
