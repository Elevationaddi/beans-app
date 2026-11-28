"use client";
import {
  adminCustomerListResponseSchema,
  adminCustomerResponseSchema,
  adminCustomerSchema,
  type AdminCustomer,
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
  TextField,
  formatDateTime,
  formatFils,
  useApi,
  useI18n,
  usePaged,
  useQuery,
} from "@beans/web";
import { useState } from "react";
import { z } from "zod";
import { orderTone, statusTone, useRoles } from "../../../lib/admin";
import { NoAccess, ReasonDialog } from "../../../lib/ui";

/** A03: find a customer, see their account summary (audited), suspend or restore. */
export default function CustomersPage() {
  const { t, locale } = useI18n();
  const api = useApi();
  const { can } = useRoles();
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const list = usePaged(
    (cursor, signal) =>
      api.get(
        "/v1/admin/customers",
        adminCustomerListResponseSchema,
        { q, status, cursor, limit: 25 },
        signal,
      ),
    [q, status],
  );
  if (!can("support", "operations", "security")) return <NoAccess />;
  return (
    <>
      <PageHeader title={t("customers.title")} subtitle={t("customers.subtitle")} />
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setQ(search.trim().length >= 2 ? search.trim() : "");
        }}
      >
        <FilterBar>
          <TextField
            label={t("customers.search")}
            hint={t("customers.searchHint")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            data-testid="customer-search"
          />
          <SelectField
            label={t("common.status")}
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            options={[
              { value: "", label: t("common.all") },
              ...["active", "suspended", "deleted"].map((s) => ({
                value: s,
                label: t(`userStatus.${s}`),
              })),
            ]}
          />
          <Button type="submit" variant="secondary">
            {t("common.search")}
          </Button>
        </FilterBar>
      </form>
      {list.error ? <ErrorState error={list.error} onRetry={list.reload} /> : null}
      <DataTable<AdminCustomer>
        caption={t("customers.title")}
        rows={list.items}
        rowKey={(r) => r.id}
        onRowClick={(r) => setOpenId(r.id)}
        emptyText={list.loading ? t("common.loading") : t("customers.empty")}
        columns={[
          { key: "name", header: t("common.name"), render: (r) => r.displayName ?? "—" },
          { key: "email", header: t("common.email"), render: (r) => r.email ?? "—" },
          { key: "phone", header: t("common.phone"), render: (r) => <bdi>{r.phone ?? "—"}</bdi> },
          {
            key: "status",
            header: t("common.status"),
            render: (r) => (
              <StatusChip tone={statusTone[r.status]}>{t(`userStatus.${r.status}`)}</StatusChip>
            ),
          },
          {
            key: "created",
            header: t("customers.joined"),
            render: (r) => formatDateTime(r.createdAt, locale),
          },
        ]}
      />
      <LoadMore hasMore={list.hasMore} loading={list.loading} onMore={() => void list.more()} />
      {openId ? (
        <CustomerDialog id={openId} onClose={() => setOpenId(null)} onChanged={list.reload} />
      ) : null}
    </>
  );
}

function CustomerDialog({
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
  const [changing, setChanging] = useState(false);
  const detail = useQuery(
    async (signal) =>
      (await api.get(`/v1/admin/customers/${id}`, adminCustomerResponseSchema, {}, signal)).data,
    [id],
  );
  const c = detail.data;
  const next = c?.status === "active" ? "suspended" : "active";
  return (
    <Dialog open wide title={c?.displayName ?? t("customers.title")} onClose={onClose}>
      {detail.error && !c ? <ErrorState error={detail.error} onRetry={detail.reload} /> : null}
      {!c && !detail.error ? <Loading /> : null}
      {c ? (
        <>
          <p className="muted small">{t("customers.auditedRead")}</p>
          <DefinitionList
            items={[
              [t("common.email"), c.email ?? "—"],
              [t("common.phone"), <bdi key="p">{c.phone ?? "—"}</bdi>],
              [t("common.language"), c.locale === "ar" ? "العربية" : "English"],
              [
                t("common.status"),
                <StatusChip key="s" tone={statusTone[c.status]}>
                  {t(`userStatus.${c.status}`)}
                </StatusChip>,
              ],
              [t("customers.orders"), `${c.completedOrderCount} / ${c.orderCount}`],
              [t("customers.spent"), formatFils(c.spentFils, locale)],
              [t("customers.openTickets"), c.openTickets],
              [
                t("customers.memberships"),
                c.memberships.length
                  ? c.memberships.map((m) => `${m.brandName} (${m.role})`).join(", ")
                  : "—",
              ],
              [
                t("customers.adminRoles"),
                c.adminRoles.length ? c.adminRoles.map((r) => t(`role.${r}`)).join(", ") : "—",
              ],
            ]}
          />
          <h3>{t("customers.recentOrders")}</h3>
          <DataTable
            caption={t("customers.recentOrders")}
            rows={c.recentOrders}
            rowKey={(o) => o.id}
            emptyText={t("customers.noOrders")}
            columns={[
              { key: "n", header: t("orders.number"), render: (o) => <bdi>{o.publicNumber}</bdi> },
              {
                key: "s",
                header: t("common.status"),
                render: (o) => (
                  <StatusChip tone={orderTone[o.status]}>{t(`orderStatus.${o.status}`)}</StatusChip>
                ),
              },
              {
                key: "tot",
                header: t("orders.total"),
                render: (o) => formatFils(o.totalFils, locale),
              },
              {
                key: "at",
                header: t("common.when"),
                render: (o) => formatDateTime(o.createdAt, locale),
              },
            ]}
          />
          {can("support", "security") && c.status !== "deleted" && c.adminRoles.length === 0 ? (
            <div className="row" style={{ marginBlockStart: 16 }}>
              <Button
                variant={next === "suspended" ? "destructive" : "primary"}
                onClick={() => setChanging(true)}
                data-testid="customer-status"
              >
                {t(next === "suspended" ? "customers.suspend" : "customers.restore")}
              </Button>
            </div>
          ) : null}
        </>
      ) : null}
      {changing && c ? (
        <ReasonDialog
          title={t(next === "suspended" ? "customers.suspend" : "customers.restore")}
          body={
            <p>{t(next === "suspended" ? "customers.suspendHint" : "customers.restoreHint")}</p>
          }
          confirmLabel={t("common.confirm")}
          destructive={next === "suspended"}
          onConfirm={(reason) =>
            api.post(`/v1/admin/customers/${id}/status`, z.object({ data: adminCustomerSchema }), {
              status: next,
              reason,
            })
          }
          onClose={() => setChanging(false)}
          onDone={() => {
            setChanging(false);
            detail.reload();
            onChanged();
          }}
        />
      ) : null}
    </Dialog>
  );
}
