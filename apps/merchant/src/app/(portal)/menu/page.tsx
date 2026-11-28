"use client";
import {
  categoryListResponseSchema,
  categoryResponseSchema,
  modifierGroupListResponseSchema,
  modifierGroupResponseSchema,
  productListResponseSchema,
  productResponseSchema,
  type Category,
  type ModifierGroup,
  type Product,
} from "@beans/contracts";
import {
  ActionError,
  Button,
  Checkbox,
  DataTable,
  Dialog,
  FilterBar,
  LoadMore,
  PageHeader,
  QueryView,
  SelectField,
  StatusChip,
  Tabs,
  TextArea,
  TextField,
  formatFils,
  useAction,
  useApi,
  useI18n,
  usePaged,
  useQuery,
  useToast,
} from "@beans/web";
import { useState } from "react";
import { aedToFils, filsToAedInput } from "../../../lib/data";
import { useMerchant } from "../../../lib/merchant";

type Tab = "products" | "categories" | "options";

/** B04: products, categories and customisation options, with draft, publish and archive. */
export default function MenuPage() {
  const { t } = useI18n();
  const [tab, setTab] = useState<Tab>("products");
  return (
    <>
      <PageHeader title={t("menu.title")} subtitle={t("menu.subtitle")} />
      <Tabs
        label={t("menu.title")}
        value={tab}
        onChange={setTab}
        tabs={[
          { value: "products", label: t("menu.products") },
          { value: "categories", label: t("menu.categories") },
          { value: "options", label: t("menu.options") },
        ]}
      />
      {tab === "products" ? <Products /> : tab === "categories" ? <Categories /> : <Groups />}
    </>
  );
}

function useCategories() {
  const api = useApi();
  const { merchantId } = useMerchant();
  return useQuery<Category[]>(
    async (signal) =>
      (
        await api.get(
          "/v1/merchant/categories",
          categoryListResponseSchema,
          { merchantId, limit: 100 },
          signal,
        )
      ).data,
    [merchantId],
    { enabled: Boolean(merchantId) },
  );
}
function useGroups() {
  const api = useApi();
  const { merchantId } = useMerchant();
  return useQuery<ModifierGroup[]>(
    async (signal) =>
      (
        await api.get(
          "/v1/merchant/modifier-groups",
          modifierGroupListResponseSchema,
          { merchantId, limit: 100 },
          signal,
        )
      ).data,
    [merchantId],
    { enabled: Boolean(merchantId) },
  );
}

function Products() {
  const { t, locale } = useI18n();
  const api = useApi();
  const { merchantId } = useMerchant();
  const categories = useCategories();
  const groups = useGroups();
  const [categoryId, setCategoryId] = useState("");
  const [status, setStatus] = useState("");
  const [editing, setEditing] = useState<Product | "new" | null>(null);
  const list = usePaged(
    (cursor, signal) =>
      api.get(
        "/v1/merchant/products",
        productListResponseSchema,
        { merchantId, categoryId, status, cursor, limit: 50 },
        signal,
      ),
    [merchantId, categoryId, status],
  );
  const catName = (id: string) =>
    categories.data?.find((c) => c.id === id)?.names[locale] ??
    categories.data?.find((c) => c.id === id)?.names.en ??
    "—";
  return (
    <>
      <FilterBar>
        <SelectField
          label={t("menu.category")}
          value={categoryId}
          onChange={(e) => setCategoryId(e.target.value)}
          options={[
            { value: "", label: t("common.all") },
            ...(categories.data ?? []).map((c) => ({
              value: c.id,
              label: c.names[locale] ?? c.names.en,
            })),
          ]}
        />
        <SelectField
          label={t("menu.status")}
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          options={[
            { value: "", label: t("common.all") },
            ...["draft", "published", "archived"].map((s) => ({
              value: s,
              label: t(`productStatus.${s}`),
            })),
          ]}
        />
        <span className="spacer" />
        <Button
          onClick={() => setEditing("new")}
          disabled={!categories.data?.length}
          data-testid="new-product"
        >
          {t("menu.newProduct")}
        </Button>
      </FilterBar>
      {categories.data && categories.data.length === 0 ? (
        <p className="muted">{t("menu.needCategory")}</p>
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
            caption={t("menu.products")}
            rows={rows}
            rowKey={(p) => p.id}
            onRowClick={(p) => setEditing(p)}
            emptyText={t("menu.noProducts")}
            columns={[
              { key: "name", header: t("menu.name"), render: (p) => p.names[locale] ?? p.names.en },
              { key: "cat", header: t("menu.category"), render: (p) => catName(p.categoryId) },
              {
                key: "price",
                header: t("menu.price"),
                render: (p) => formatFils(p.priceFils, locale),
                className: "num",
              },
              {
                key: "status",
                header: t("menu.status"),
                render: (p) => (
                  <StatusChip
                    tone={
                      p.status === "published"
                        ? "success"
                        : p.status === "draft"
                          ? "warning"
                          : "neutral"
                    }
                  >
                    {t(`productStatus.${p.status}`)}
                  </StatusChip>
                ),
              },
            ]}
          />
        )}
      </QueryView>
      <LoadMore hasMore={list.hasMore} loading={list.loading} onMore={() => void list.more()} />
      {editing ? (
        <ProductDialog
          product={editing === "new" ? null : editing}
          categories={categories.data ?? []}
          groups={groups.data ?? []}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            list.reload();
          }}
        />
      ) : null}
    </>
  );
}

function ProductDialog({
  product,
  categories,
  groups,
  onClose,
  onSaved,
}: {
  product: Product | null;
  categories: Category[];
  groups: ModifierGroup[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t, locale } = useI18n();
  const api = useApi();
  const toast = useToast();
  const { merchantId } = useMerchant();
  const [f, setF] = useState({
    nameEn: product?.names.en ?? "",
    nameAr: product?.names.ar ?? "",
    descEn: product?.descriptions.en ?? "",
    descAr: product?.descriptions.ar ?? "",
    price: product ? filsToAedInput(product.priceFils) : "",
    categoryId: product?.categoryId ?? categories[0]?.id ?? "",
    allergens: product?.allergens.join(", ") ?? "",
    groupIds: product?.groupIds ?? [],
  });
  const [priceError, setPriceError] = useState<string>();
  const save = useAction(async (status?: "draft" | "published" | "archived") => {
    const priceFils = aedToFils(f.price);
    if (!priceFils) {
      setPriceError(t("menu.priceInvalid"));
      return;
    }
    setPriceError(undefined);
    const body = {
      categoryId: f.categoryId,
      names: { en: f.nameEn.trim(), ...(f.nameAr.trim() ? { ar: f.nameAr.trim() } : {}) },
      descriptions: {
        ...(f.descEn.trim() ? { en: f.descEn.trim() } : {}),
        ...(f.descAr.trim() ? { ar: f.descAr.trim() } : {}),
      },
      priceFils,
      allergens: f.allergens
        .split(",")
        .map((a) => a.trim().toLowerCase())
        .filter(Boolean),
      groupIds: f.groupIds,
    };
    if (product)
      await api.patch(`/v1/merchant/products/${product.id}`, productResponseSchema, {
        expectedVersion: product.version,
        ...body,
        ...(status ? { status } : {}),
      });
    else {
      const created = await api.post("/v1/merchant/products", productResponseSchema, {
        merchantId,
        ...body,
      });
      if (status === "published")
        await api.patch(`/v1/merchant/products/${created.data.id}`, productResponseSchema, {
          expectedVersion: created.data.version,
          status,
        });
    }
    toast(t("common.saved"));
    onSaved();
  });
  const fe = save.error?.fieldErrors ?? {};
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) =>
    setF({ ...f, [k]: e.target.value });
  return (
    <Dialog
      open
      wide
      onClose={onClose}
      title={product ? t("menu.editProduct") : t("menu.newProduct")}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          {product && product.status !== "archived" ? (
            <Button
              variant="destructive"
              onClick={() => void save.run("archived")}
              loading={save.pending}
            >
              {t("menu.archive")}
            </Button>
          ) : null}
          <Button
            variant="secondary"
            onClick={() => void save.run(product ? undefined : "draft")}
            loading={save.pending}
            data-testid="save-draft"
          >
            {product ? t("common.save") : t("menu.saveDraft")}
          </Button>
          {product?.status !== "published" ? (
            <Button
              onClick={() => void save.run("published")}
              loading={save.pending}
              data-testid="publish-product"
            >
              {t("menu.publish")}
            </Button>
          ) : null}
        </>
      }
    >
      <div className="grid-2">
        <TextField
          label={t("menu.nameEn")}
          value={f.nameEn}
          onChange={set("nameEn")}
          error={fe["names.en"]}
          required
        />
        <TextField
          label={t("menu.nameAr")}
          value={f.nameAr}
          onChange={set("nameAr")}
          dir="rtl"
          hint={t("branch.arHint")}
        />
        <TextField
          label={t("menu.priceAed")}
          inputMode="decimal"
          value={f.price}
          onChange={set("price")}
          error={priceError ?? fe["priceFils"]}
          hint={t("menu.priceHint")}
          required
        />
        <SelectField
          label={t("menu.category")}
          value={f.categoryId}
          onChange={set("categoryId")}
          options={categories.map((c) => ({ value: c.id, label: c.names[locale] ?? c.names.en }))}
        />
      </div>
      <TextArea label={t("menu.descEn")} value={f.descEn} onChange={set("descEn")} />
      <TextArea label={t("menu.descAr")} value={f.descAr} onChange={set("descAr")} dir="rtl" />
      <TextField
        label={t("menu.allergens")}
        value={f.allergens}
        onChange={set("allergens")}
        hint={t("menu.allergensHint")}
        error={fe["allergens"]}
      />
      <fieldset className="field">
        <legend>{t("menu.options")}</legend>
        {groups.length === 0 ? <p className="muted small">{t("menu.noGroups")}</p> : null}
        {groups.map((g) => (
          <Checkbox
            key={g.id}
            label={`${g.names[locale] ?? g.names.en} (${g.minCount}–${g.maxCount})`}
            checked={f.groupIds.includes(g.id)}
            onChange={(on) =>
              setF({
                ...f,
                groupIds: on ? [...f.groupIds, g.id] : f.groupIds.filter((x) => x !== g.id),
              })
            }
          />
        ))}
      </fieldset>
      <p className="muted small">{t("menu.snapshotNote")}</p>
      <ActionError error={save.error} />
    </Dialog>
  );
}

function Categories() {
  const { t, locale } = useI18n();
  const api = useApi();
  const toast = useToast();
  const { merchantId } = useMerchant();
  const categories = useCategories();
  const [editing, setEditing] = useState<Category | "new" | null>(null);
  const [f, setF] = useState({ en: "", ar: "", sort: "0", active: true });
  const open = (c: Category | "new") => {
    setEditing(c);
    setF(
      c === "new"
        ? { en: "", ar: "", sort: "0", active: true }
        : { en: c.names.en, ar: c.names.ar ?? "", sort: String(c.sort), active: c.active },
    );
  };
  const save = useAction(async () => {
    const names = { en: f.en.trim(), ...(f.ar.trim() ? { ar: f.ar.trim() } : {}) };
    if (editing === "new")
      await api.post("/v1/merchant/categories", categoryResponseSchema, {
        merchantId,
        names,
        sort: Number(f.sort),
      });
    else if (editing)
      await api.patch(`/v1/merchant/categories/${editing.id}`, categoryResponseSchema, {
        names,
        sort: Number(f.sort),
        active: f.active,
      });
    toast(t("common.saved"));
    setEditing(null);
    categories.reload();
  });
  return (
    <>
      <FilterBar>
        <span className="spacer" />
        <Button onClick={() => open("new")} data-testid="new-category">
          {t("menu.newCategory")}
        </Button>
      </FilterBar>
      <QueryView query={categories}>
        {(rows) => (
          <DataTable
            caption={t("menu.categories")}
            rows={[...rows].sort((a, b) => a.sort - b.sort)}
            rowKey={(c) => c.id}
            onRowClick={open}
            emptyText={t("menu.noCategories")}
            columns={[
              { key: "name", header: t("menu.name"), render: (c) => c.names[locale] ?? c.names.en },
              { key: "sort", header: t("menu.sort"), render: (c) => c.sort, className: "num" },
              {
                key: "active",
                header: t("menu.visible"),
                render: (c) => (
                  <StatusChip tone={c.active ? "success" : "neutral"}>
                    {c.active ? t("common.yes") : t("common.no")}
                  </StatusChip>
                ),
              },
            ]}
          />
        )}
      </QueryView>
      <Dialog
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing === "new" ? t("menu.newCategory") : t("menu.editCategory")}
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditing(null)}>
              {t("common.cancel")}
            </Button>
            <Button
              loading={save.pending}
              onClick={() => void save.run()}
              data-testid="save-category"
            >
              {t("common.save")}
            </Button>
          </>
        }
      >
        <TextField
          label={t("menu.nameEn")}
          value={f.en}
          onChange={(e) => setF({ ...f, en: e.target.value })}
          error={save.error?.fieldErrors["names.en"]}
        />
        <TextField
          label={t("menu.nameAr")}
          value={f.ar}
          onChange={(e) => setF({ ...f, ar: e.target.value })}
          dir="rtl"
        />
        <TextField
          label={t("menu.sort")}
          type="number"
          value={f.sort}
          onChange={(e) => setF({ ...f, sort: e.target.value })}
        />
        {editing !== "new" ? (
          <Checkbox
            label={t("menu.visible")}
            checked={f.active}
            onChange={(active) => setF({ ...f, active })}
          />
        ) : null}
        <ActionError error={save.error} />
      </Dialog>
    </>
  );
}

interface OptionDraft {
  id?: string;
  en: string;
  ar: string;
  delta: string;
}

function Groups() {
  const { t, locale } = useI18n();
  const api = useApi();
  const toast = useToast();
  const { merchantId } = useMerchant();
  const groups = useGroups();
  const [editing, setEditing] = useState<ModifierGroup | "new" | null>(null);
  const [f, setF] = useState({ en: "", ar: "", min: "0", max: "1", options: [] as OptionDraft[] });
  const open = (g: ModifierGroup | "new") => {
    setEditing(g);
    setF(
      g === "new"
        ? { en: "", ar: "", min: "0", max: "1", options: [{ en: "", ar: "", delta: "0.00" }] }
        : {
            en: g.names.en,
            ar: g.names.ar ?? "",
            min: String(g.minCount),
            max: String(g.maxCount),
            options: g.options
              .filter((o) => o.active)
              .map((o) => ({
                id: o.id,
                en: o.names.en,
                ar: o.names.ar ?? "",
                delta: filsToAedInput(o.deltaFils),
              })),
          },
    );
  };
  const save = useAction(async () => {
    const options = f.options.map((o) => {
      const deltaFils = aedToFils(o.delta);
      if (!deltaFils) throw new Error(t("menu.priceInvalid"));
      return {
        ...(o.id ? { id: o.id } : {}),
        names: { en: o.en.trim(), ...(o.ar.trim() ? { ar: o.ar.trim() } : {}) },
        deltaFils,
      };
    });
    const names = { en: f.en.trim(), ...(f.ar.trim() ? { ar: f.ar.trim() } : {}) };
    if (editing === "new")
      await api.post("/v1/merchant/modifier-groups", modifierGroupResponseSchema, {
        merchantId,
        names,
        minCount: Number(f.min),
        maxCount: Number(f.max),
        options: options.map(({ names, deltaFils }) => ({ names, deltaFils })),
      });
    else if (editing)
      await api.patch(`/v1/merchant/modifier-groups/${editing.id}`, modifierGroupResponseSchema, {
        expectedVersion: editing.version,
        names,
        minCount: Number(f.min),
        maxCount: Number(f.max),
        options,
      });
    toast(t("common.saved"));
    setEditing(null);
    groups.reload();
  });
  const setOpt = (i: number, patch: Partial<OptionDraft>) =>
    setF({ ...f, options: f.options.map((o, idx) => (idx === i ? { ...o, ...patch } : o)) });
  return (
    <>
      <FilterBar>
        <span className="spacer" />
        <Button onClick={() => open("new")} data-testid="new-group">
          {t("menu.newGroup")}
        </Button>
      </FilterBar>
      <QueryView query={groups}>
        {(rows) => (
          <DataTable
            caption={t("menu.options")}
            rows={rows}
            rowKey={(g) => g.id}
            onRowClick={open}
            emptyText={t("menu.noGroups")}
            columns={[
              { key: "name", header: t("menu.name"), render: (g) => g.names[locale] ?? g.names.en },
              {
                key: "rule",
                header: t("menu.choices"),
                render: (g) => t("menu.choiceRule", { min: g.minCount, max: g.maxCount }),
              },
              {
                key: "opts",
                header: t("menu.optionList"),
                render: (g) =>
                  g.options
                    .filter((o) => o.active)
                    .map(
                      (o) =>
                        `${o.names[locale] ?? o.names.en}${o.deltaFils !== "0" ? ` (+${formatFils(o.deltaFils, locale)})` : ""}`,
                    )
                    .join(", "),
              },
            ]}
          />
        )}
      </QueryView>
      <Dialog
        wide
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing === "new" ? t("menu.newGroup") : t("menu.editGroup")}
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditing(null)}>
              {t("common.cancel")}
            </Button>
            <Button loading={save.pending} onClick={() => void save.run()} data-testid="save-group">
              {t("common.save")}
            </Button>
          </>
        }
      >
        <div className="grid-2">
          <TextField
            label={t("menu.nameEn")}
            value={f.en}
            onChange={(e) => setF({ ...f, en: e.target.value })}
          />
          <TextField
            label={t("menu.nameAr")}
            value={f.ar}
            onChange={(e) => setF({ ...f, ar: e.target.value })}
            dir="rtl"
          />
          <TextField
            label={t("menu.min")}
            type="number"
            min={0}
            max={20}
            value={f.min}
            onChange={(e) => setF({ ...f, min: e.target.value })}
            hint={t("menu.minHint")}
          />
          <TextField
            label={t("menu.max")}
            type="number"
            min={1}
            max={20}
            value={f.max}
            onChange={(e) => setF({ ...f, max: e.target.value })}
          />
        </div>
        <h3>{t("menu.optionList")}</h3>
        {f.options.map((o, i) => (
          <div className="option-row" key={o.id ?? `new-${i}`}>
            <TextField
              label={t("menu.nameEn")}
              value={o.en}
              onChange={(e) => setOpt(i, { en: e.target.value })}
            />
            <TextField
              label={t("menu.nameAr")}
              value={o.ar}
              onChange={(e) => setOpt(i, { ar: e.target.value })}
              dir="rtl"
            />
            <TextField
              label={t("menu.extraAed")}
              inputMode="decimal"
              value={o.delta}
              onChange={(e) => setOpt(i, { delta: e.target.value })}
            />
            <Button
              variant="ghost"
              onClick={() => setF({ ...f, options: f.options.filter((_, idx) => idx !== i) })}
              disabled={f.options.length <= 1}
            >
              {t("common.remove")}
            </Button>
          </div>
        ))}
        <Button
          variant="secondary"
          onClick={() => setF({ ...f, options: [...f.options, { en: "", ar: "", delta: "0.00" }] })}
        >
          {t("menu.addOption")}
        </Button>
        <ActionError error={save.error} />
      </Dialog>
    </>
  );
}
