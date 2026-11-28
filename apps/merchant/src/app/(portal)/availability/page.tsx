"use client";
import {
  branchOptionResponseSchema,
  branchProductResponseSchema,
  merchantBranchAvailabilityResponseSchema,
  type MerchantBranchAvailability,
} from "@beans/contracts";
import {
  ActionError,
  Banner,
  Button,
  Checkbox,
  DataTable,
  FilterBar,
  PageHeader,
  QueryView,
  SelectField,
  StatusChip,
  Tabs,
  TextField,
  formatFils,
  useAction,
  useApi,
  useI18n,
  useQuery,
  useToast,
} from "@beans/web";
import { useState } from "react";
import { aedToFils, branchName, filsToAedInput, useBranches } from "../../../lib/data";

type Product = MerchantBranchAvailability["products"][number];
type Option = MerchantBranchAvailability["options"][number];

/** B05: sold-out toggles, branch prices and tracked stock, per branch. Changes apply at once and are audited. */
export default function AvailabilityPage() {
  const { t, locale } = useI18n();
  const api = useApi();
  const branches = useBranches();
  const [chosenBranch, setBranchId] = useState("");
  // Until someone picks a branch, show the first one they can see.
  const branchId = chosenBranch || branches.data?.[0]?.id || "";
  const [tab, setTab] = useState<"products" | "options">("products");
  const query = useQuery(
    async (signal) =>
      (
        await api.get(
          `/v1/merchant/branches/${branchId}/availability`,
          merchantBranchAvailabilityResponseSchema,
          undefined,
          signal,
        )
      ).data,
    [branchId],
    { enabled: Boolean(branchId) },
  );
  return (
    <>
      <PageHeader title={t("availability.title")} subtitle={t("availability.subtitle")} />
      <FilterBar>
        <SelectField
          label={t("filter.branch")}
          value={branchId}
          onChange={(e) => setBranchId(e.target.value)}
          options={(branches.data ?? []).map((b) => ({
            value: b.id,
            label: branchName(b, locale),
          }))}
          data-testid="availability-branch"
        />
      </FilterBar>
      <Tabs
        label={t("availability.title")}
        value={tab}
        onChange={setTab}
        tabs={[
          { value: "products", label: t("menu.products") },
          { value: "options", label: t("menu.options") },
        ]}
      />
      {branchId ? (
        <QueryView query={query}>
          {(d) =>
            tab === "products" ? (
              <ProductRows branchId={branchId} rows={d.products} onSaved={query.reload} />
            ) : (
              <OptionRows branchId={branchId} rows={d.options} onSaved={query.reload} />
            )
          }
        </QueryView>
      ) : null}
    </>
  );
}

function ProductRows({
  branchId,
  rows,
  onSaved,
}: {
  branchId: string;
  rows: Product[];
  onSaved: () => void;
}) {
  const { t, locale } = useI18n();
  return (
    <>
      <Banner tone="info">{t("availability.stockHint")}</Banner>
      <DataTable
        caption={t("menu.products")}
        rows={rows}
        rowKey={(p) => p.productId}
        emptyText={t("menu.noProducts")}
        columns={[
          {
            key: "name",
            header: t("menu.name"),
            render: (p) => (
              <>
                {p.names[locale] ?? p.names.en}{" "}
                {p.productStatus === "draft" ? (
                  <StatusChip tone="warning">{t("productStatus.draft")}</StatusChip>
                ) : null}
              </>
            ),
          },
          {
            key: "base",
            header: t("availability.basePrice"),
            render: (p) => formatFils(p.basePriceFils, locale),
            className: "num",
          },
          {
            key: "edit",
            header: t("availability.branchSettings"),
            render: (p) => <ProductEditor branchId={branchId} row={p} onSaved={onSaved} />,
          },
        ]}
      />
    </>
  );
}

function ProductEditor({
  branchId,
  row,
  onSaved,
}: {
  branchId: string;
  row: Product;
  onSaved: () => void;
}) {
  const { t } = useI18n();
  const api = useApi();
  const toast = useToast();
  const [enabled, setEnabled] = useState(row.enabled);
  const [price, setPrice] = useState(
    row.priceOverrideFils ? filsToAedInput(row.priceOverrideFils) : "",
  );
  const [tracked, setTracked] = useState(row.stockOnHand !== null);
  const [stock, setStock] = useState(String(row.stockOnHand ?? 0));
  const save = useAction(async (overrideEnabled?: boolean) => {
    const priceOverrideFils = price.trim() ? aedToFils(price) : null;
    if (price.trim() && !priceOverrideFils) throw new Error(t("menu.priceInvalid"));
    const nextEnabled = overrideEnabled ?? enabled;
    await api.put(
      `/v1/merchant/branches/${branchId}/products/${row.productId}`,
      branchProductResponseSchema,
      { enabled: nextEnabled, priceOverrideFils, stockOnHand: tracked ? Number(stock) : null },
    );
    setEnabled(nextEnabled);
    toast(t("common.saved"));
    onSaved();
  });
  return (
    <div className="stack" style={{ gap: 4 }}>
      <div className="row">
        <StatusChip tone={row.enabled ? "success" : "error"}>
          {row.enabled ? t("availability.available") : t("availability.soldOut")}
        </StatusChip>
        <Button
          variant={row.enabled ? "secondary" : "primary"}
          onClick={() => void save.run(!row.enabled)}
          loading={save.pending}
          data-testid={`toggle-${row.productId}`}
        >
          {row.enabled ? t("availability.markSoldOut") : t("availability.markAvailable")}
        </Button>
      </div>
      <div className="row">
        <TextField
          label={t("availability.priceOverride")}
          inputMode="decimal"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          hint={t("availability.priceOverrideHint")}
        />
        <Checkbox label={t("availability.trackStock")} checked={tracked} onChange={setTracked} />
        {tracked ? (
          <TextField
            label={t("availability.onHand")}
            type="number"
            min={row.stockReserved}
            value={stock}
            onChange={(e) => setStock(e.target.value)}
            hint={t("availability.held", { n: row.stockReserved })}
          />
        ) : null}
        <Button variant="secondary" onClick={() => void save.run()} loading={save.pending}>
          {t("common.save")}
        </Button>
      </div>
      <ActionError error={save.error} />
    </div>
  );
}

function OptionRows({
  branchId,
  rows,
  onSaved,
}: {
  branchId: string;
  rows: Option[];
  onSaved: () => void;
}) {
  const { t, locale } = useI18n();
  const api = useApi();
  const toast = useToast();
  const toggle = useAction(async (o: Option) => {
    await api.put(
      `/v1/merchant/branches/${branchId}/options/${o.optionId}`,
      branchOptionResponseSchema,
      { enabled: !o.enabled, deltaOverrideFils: o.deltaOverrideFils },
    );
    toast(t("common.saved"));
    onSaved();
  });
  return (
    <>
      <DataTable
        caption={t("menu.options")}
        rows={rows}
        rowKey={(o) => o.optionId}
        emptyText={t("menu.noGroups")}
        columns={[
          {
            key: "group",
            header: t("availability.group"),
            render: (o) => o.groupNames[locale] ?? o.groupNames.en,
          },
          { key: "name", header: t("menu.name"), render: (o) => o.names[locale] ?? o.names.en },
          {
            key: "delta",
            header: t("menu.extraAed"),
            render: (o) => formatFils(o.deltaOverrideFils ?? o.baseDeltaFils, locale),
            className: "num",
          },
          {
            key: "state",
            header: t("availability.state"),
            render: (o) => (
              <Button
                variant={o.enabled ? "secondary" : "primary"}
                onClick={() => void toggle.run(o)}
                disabled={toggle.pending}
              >
                {o.enabled ? t("availability.markSoldOut") : t("availability.markAvailable")}
              </Button>
            ),
          },
        ]}
      />
      <ActionError error={toggle.error} />
    </>
  );
}
