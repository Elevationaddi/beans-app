"use client";
import {
  branchTableListResponseSchema,
  branchTableResponseSchema,
  promotionListResponseSchema,
  promotionResponseSchema,
  stampCardResponseSchema,
  type BranchTable,
  type Promotion,
  type StampCard,
} from "@beans/contracts";
import {
  ActionError,
  Banner,
  Button,
  Card,
  Checkbox,
  ConfirmDialog,
  DataTable,
  Dialog,
  EmptyState,
  LoadMore,
  PageHeader,
  QueryView,
  SelectField,
  StatusChip,
  Tabs,
  TextField,
  formatDate,
  formatFils,
  useAction,
  useApi,
  useI18n,
  usePaged,
  useQuery,
  useToast,
  type Tone,
} from "@beans/web";
import QRCode from "qrcode";
import { useEffect, useState } from "react";
import { customerAppUrl } from "../../../lib/config";
import { aedToFils, branchName, filsToAedInput, useBranches } from "../../../lib/data";
import { useMerchant } from "../../../lib/merchant";

type Tab = "stamps" | "promotions" | "tables";

/** B08: stamp card, promotions (sent to admin review) and dine-in table QR codes. Sandbox. */
export default function LoyaltyPage() {
  const { t } = useI18n();
  const { isOwner } = useMerchant();
  const tabs: { value: Tab; label: string }[] = [
    ...(isOwner
      ? [
          { value: "stamps" as const, label: t("loyalty.stamps") },
          { value: "promotions" as const, label: t("loyalty.promotions") },
        ]
      : []),
    { value: "tables", label: t("loyalty.tables") },
  ];
  const [tab, setTab] = useState<Tab>(isOwner ? "stamps" : "tables");
  return (
    <>
      <PageHeader title={t("nav.marketing")} subtitle={t("loyalty.subtitle")} />
      <Banner tone="warning">{t("loyalty.sandbox")}</Banner>
      <Tabs tabs={tabs} value={tab} onChange={setTab} label={t("nav.marketing")} />
      {tab === "stamps" && isOwner ? <StampCardTab /> : null}
      {tab === "promotions" && isOwner ? <PromotionsTab /> : null}
      {tab === "tables" ? <TablesTab /> : null}
    </>
  );
}

// ── Stamp card ──────────────────────────────────────────────────────────────

function StampCardTab() {
  const api = useApi();
  const { merchantId } = useMerchant();
  const query = useQuery(
    async (signal) =>
      (await api.get("/v1/merchant/stamp-card", stampCardResponseSchema, { merchantId }, signal))
        .data,
    [merchantId],
    { enabled: Boolean(merchantId) },
  );
  return (
    <QueryView query={query}>
      {(card) => (
        <StampCardForm key={card?.updatedAt ?? "new"} card={card} onSaved={query.reload} />
      )}
    </QueryView>
  );
}

function StampCardForm({ card, onSaved }: { card: StampCard | null; onSaved: () => void }) {
  const { t } = useI18n();
  const api = useApi();
  const toast = useToast();
  const { merchantId } = useMerchant();
  const [nameEn, setNameEn] = useState(card?.names.en ?? "");
  const [nameAr, setNameAr] = useState(card?.names.ar ?? "");
  const [stamps, setStamps] = useState(String(card?.stampsRequired ?? 8));
  const [rewardEn, setRewardEn] = useState(card?.reward.en ?? "");
  const [rewardAr, setRewardAr] = useState(card?.reward.ar ?? "");
  const [max, setMax] = useState(card ? filsToAedInput(card.rewardMaxFils) : "");
  const [active, setActive] = useState(card?.active ?? true);
  const [local, setLocal] = useState<string | null>(null);
  const save = useAction(async () => {
    const rewardMaxFils = aedToFils(max);
    if (!rewardMaxFils) {
      setLocal(t("loyalty.amountInvalid"));
      return;
    }
    setLocal(null);
    await api.put(
      `/v1/merchant/stamp-card?merchantId=${encodeURIComponent(merchantId)}`,
      stampCardResponseSchema,
      {
        names: { en: nameEn, ...(nameAr ? { ar: nameAr } : {}) },
        stampsRequired: Number(stamps),
        reward: { en: rewardEn, ...(rewardAr ? { ar: rewardAr } : {}) },
        rewardMaxFils,
        active,
      },
    );
    toast(t("common.saved"));
    onSaved();
  });
  const err = save.error?.fieldErrors ?? {};
  return (
    <Card title={t("loyalty.stampCard")}>
      <p className="muted">{t("loyalty.stampHelp")}</p>
      {card ? (
        <p className="small muted" data-testid="terms-version">
          {t("loyalty.termsVersion", { version: card.termsVersion })}
        </p>
      ) : (
        <Banner tone="info">{t("loyalty.noCard")}</Banner>
      )}
      <div className="grid-2">
        <TextField
          label={t("loyalty.nameEn")}
          value={nameEn}
          onChange={(e) => setNameEn(e.target.value)}
          error={err["names.en"]}
          data-testid="card-name"
        />
        <TextField
          label={t("loyalty.nameAr")}
          value={nameAr}
          onChange={(e) => setNameAr(e.target.value)}
          dir="rtl"
        />
        <TextField
          label={t("loyalty.stampsRequired")}
          type="number"
          min={2}
          max={20}
          value={stamps}
          onChange={(e) => setStamps(e.target.value)}
          error={err["stampsRequired"]}
          hint={t("loyalty.stampsHint")}
          data-testid="card-stamps"
        />
        <TextField
          label={t("loyalty.rewardMax")}
          inputMode="decimal"
          value={max}
          onChange={(e) => setMax(e.target.value)}
          error={err["rewardMaxFils"] ?? (local ? [local] : undefined)}
          hint={t("loyalty.rewardMaxHint")}
          data-testid="card-max"
        />
        <TextField
          label={t("loyalty.rewardEn")}
          value={rewardEn}
          onChange={(e) => setRewardEn(e.target.value)}
          error={err["reward.en"]}
          data-testid="card-reward"
        />
        <TextField
          label={t("loyalty.rewardAr")}
          value={rewardAr}
          onChange={(e) => setRewardAr(e.target.value)}
          dir="rtl"
        />
      </div>
      <Checkbox label={t("loyalty.cardActive")} checked={active} onChange={setActive} />
      <ActionError error={save.error} />
      <div className="row">
        <Button loading={save.pending} onClick={() => void save.run()} data-testid="save-card">
          {t("common.save")}
        </Button>
      </div>
    </Card>
  );
}

// ── Promotions ──────────────────────────────────────────────────────────────

const promoTone: Record<Promotion["status"], Tone> = {
  draft: "neutral",
  pending_review: "info",
  approved: "success",
  rejected: "error",
  paused: "warning",
  ended: "neutral",
};

function promoValue(
  p: Promotion,
  locale: "en" | "ar",
  t: (k: string, v?: Record<string, string | number>) => string,
) {
  if (p.kind === "percent") {
    const pct = (p.percentBasisPoints ?? 0) / 100;
    return p.maxDiscountFils
      ? t("loyalty.percentUpTo", { pct, max: formatFils(p.maxDiscountFils, locale) })
      : t("loyalty.percentOff", { pct });
  }
  return t("loyalty.amountOff", { amount: formatFils(p.amountFils ?? "0", locale) });
}

function PromotionsTab() {
  const { t, locale } = useI18n();
  const api = useApi();
  const { merchantId } = useMerchant();
  const list = usePaged(
    async (cursor, signal) =>
      api.get(
        "/v1/merchant/promotions",
        promotionListResponseSchema,
        { merchantId, cursor, limit: 25 },
        signal,
      ),
    [merchantId],
  );
  const [editing, setEditing] = useState<Promotion | "new" | null>(null);
  return (
    <Card
      title={t("loyalty.promotions")}
      actions={
        <Button onClick={() => setEditing("new")} data-testid="new-promotion">
          {t("loyalty.newPromotion")}
        </Button>
      }
    >
      <p className="muted">{t("loyalty.promoHelp")}</p>
      <ActionError error={list.error} />
      <DataTable
        caption={t("loyalty.promotions")}
        rows={list.items}
        rowKey={(p) => p.id}
        onRowClick={setEditing}
        emptyText={list.loading ? t("common.loading") : t("loyalty.noPromotions")}
        columns={[
          { key: "code", header: t("loyalty.code"), render: (p) => <code>{p.code}</code> },
          {
            key: "name",
            header: t("loyalty.name"),
            render: (p) => (locale === "ar" && p.names.ar ? p.names.ar : p.names.en),
          },
          { key: "value", header: t("loyalty.discount"), render: (p) => promoValue(p, locale, t) },
          {
            key: "dates",
            header: t("loyalty.dates"),
            render: (p) => `${formatDate(p.startsAt, locale)} – ${formatDate(p.endsAt, locale)}`,
          },
          {
            key: "uses",
            header: t("loyalty.uses"),
            render: (p) =>
              p.maxRedemptions ? `${p.redemptions} / ${p.maxRedemptions}` : p.redemptions,
          },
          {
            key: "status",
            header: t("menu.status"),
            render: (p) => (
              <StatusChip tone={promoTone[p.status]}>{t(`promoStatus.${p.status}`)}</StatusChip>
            ),
          },
        ]}
      />
      <LoadMore hasMore={list.hasMore} loading={list.loading} onMore={() => void list.more()} />
      {editing ? (
        <PromotionDialog
          promotion={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onDone={() => {
            setEditing(null);
            list.reload();
          }}
        />
      ) : null}
    </Card>
  );
}

const toLocalInput = (iso: string) => {
  // datetime-local wants the wall clock; Dubai is UTC+4 all year.
  const d = new Date(new Date(iso).getTime() + 4 * 3600_000);
  return d.toISOString().slice(0, 16);
};
const fromLocalInput = (value: string) =>
  value ? new Date(new Date(`${value}:00Z`).getTime() - 4 * 3600_000).toISOString() : "";

function PromotionDialog({
  promotion,
  onClose,
  onDone,
}: {
  promotion: Promotion | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t, locale } = useI18n();
  const api = useApi();
  const toast = useToast();
  const { merchantId } = useMerchant();
  const editable = !promotion || promotion.status === "draft" || promotion.status === "rejected";
  const [defaults] = useState(() => {
    const at = Date.now();
    return { start: new Date(at).toISOString(), end: new Date(at + 14 * 86_400_000).toISOString() };
  });
  const [code, setCode] = useState(promotion?.code ?? "");
  const [nameEn, setNameEn] = useState(promotion?.names.en ?? "");
  const [nameAr, setNameAr] = useState(promotion?.names.ar ?? "");
  const [kind, setKind] = useState<Promotion["kind"]>(promotion?.kind ?? "percent");
  const [percent, setPercent] = useState(
    promotion?.percentBasisPoints ? String(promotion.percentBasisPoints / 100) : "10",
  );
  const [amount, setAmount] = useState(
    promotion?.amountFils ? filsToAedInput(promotion.amountFils) : "",
  );
  const [minimum, setMinimum] = useState(filsToAedInput(promotion?.minSubtotalFils ?? "0"));
  const [cap, setCap] = useState(
    promotion?.maxDiscountFils ? filsToAedInput(promotion.maxDiscountFils) : "",
  );
  const [startsAt, setStartsAt] = useState(toLocalInput(promotion?.startsAt ?? defaults.start));
  const [endsAt, setEndsAt] = useState(toLocalInput(promotion?.endsAt ?? defaults.end));
  const [maxUses, setMaxUses] = useState(
    promotion?.maxRedemptions ? String(promotion.maxRedemptions) : "",
  );
  const [perCustomer, setPerCustomer] = useState(String(promotion?.perCustomerLimit ?? 1));
  const [local, setLocal] = useState<Record<string, string[]>>({});

  const save = useAction(async () => {
    const problems: Record<string, string[]> = {};
    const amountFils = kind === "amount" ? aedToFils(amount) : null;
    if (kind === "amount" && !amountFils) problems.amountFils = [t("loyalty.amountInvalid")];
    const minSubtotalFils = aedToFils(minimum || "0");
    if (!minSubtotalFils) problems.minSubtotalFils = [t("loyalty.amountInvalid")];
    const maxDiscountFils = cap ? aedToFils(cap) : null;
    if (cap && !maxDiscountFils) problems.maxDiscountFils = [t("loyalty.amountInvalid")];
    setLocal(problems);
    if (Object.keys(problems).length > 0) return;
    const fields = {
      code,
      names: { en: nameEn, ...(nameAr ? { ar: nameAr } : {}) },
      kind,
      percentBasisPoints: kind === "percent" ? Math.round(Number(percent) * 100) : null,
      amountFils,
      minSubtotalFils,
      maxDiscountFils,
      startsAt: fromLocalInput(startsAt),
      endsAt: fromLocalInput(endsAt),
      maxRedemptions: maxUses ? Number(maxUses) : null,
      perCustomerLimit: Number(perCustomer),
    };
    if (promotion) {
      await api.put(`/v1/merchant/promotions/${promotion.id}`, promotionResponseSchema, {
        ...fields,
        expectedVersion: promotion.version,
      });
    } else {
      await api.post("/v1/merchant/promotions", promotionResponseSchema, { merchantId, ...fields });
    }
    toast(t("common.saved"));
    onDone();
  });
  const act = useAction(async (action: "submit" | "pause" | "resume" | "end") => {
    if (!promotion) return;
    await api.post(`/v1/merchant/promotions/${promotion.id}/actions`, promotionResponseSchema, {
      action,
      expectedVersion: promotion.version,
    });
    toast(t(`loyalty.done.${action}`));
    onDone();
  });
  const err = { ...(save.error?.fieldErrors ?? {}), ...local };
  const actions: ("submit" | "pause" | "resume" | "end")[] = !promotion
    ? []
    : promotion.status === "draft" || promotion.status === "rejected"
      ? ["submit"]
      : promotion.status === "approved"
        ? ["pause", "end"]
        : promotion.status === "paused"
          ? ["resume", "end"]
          : promotion.status === "pending_review"
            ? ["end"]
            : [];

  return (
    <Dialog
      open
      onClose={onClose}
      title={promotion ? promotion.code : t("loyalty.newPromotion")}
      footer={
        <>
          {actions.map((a) => (
            <Button
              key={a}
              variant={a === "end" ? "destructive" : "secondary"}
              loading={act.pending}
              onClick={() => void act.run(a)}
              data-testid={`promo-${a}`}
            >
              {t(`loyalty.action.${a}`)}
            </Button>
          ))}
          {editable ? (
            <Button
              loading={save.pending}
              onClick={() => void save.run()}
              data-testid="save-promotion"
            >
              {t("common.save")}
            </Button>
          ) : (
            <Button onClick={onClose}>{t("common.close")}</Button>
          )}
        </>
      }
    >
      {promotion ? (
        <p>
          <StatusChip tone={promoTone[promotion.status]}>
            {t(`promoStatus.${promotion.status}`)}
          </StatusChip>{" "}
          <span className="muted small">{promoValue(promotion, locale, t)}</span>
        </p>
      ) : null}
      {promotion?.reviewNote ? (
        <Banner tone={promotion.status === "rejected" ? "error" : "info"}>
          {t("loyalty.reviewNote", { note: promotion.reviewNote })}
        </Banner>
      ) : null}
      {editable ? (
        <>
          <p className="hint">{t("loyalty.reviewHelp")}</p>
          <div className="grid-2">
            <TextField
              label={t("loyalty.code")}
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              error={err["code"]}
              hint={t("loyalty.codeHint")}
              data-testid="promo-code"
            />
            <SelectField
              label={t("loyalty.kind")}
              value={kind}
              onChange={(e) => setKind(e.target.value as Promotion["kind"])}
              options={[
                { value: "percent", label: t("loyalty.kindPercent") },
                { value: "amount", label: t("loyalty.kindAmount") },
              ]}
            />
            <TextField
              label={t("loyalty.nameEn")}
              value={nameEn}
              onChange={(e) => setNameEn(e.target.value)}
              error={err["names.en"]}
              data-testid="promo-name"
            />
            <TextField
              label={t("loyalty.nameAr")}
              value={nameAr}
              onChange={(e) => setNameAr(e.target.value)}
              dir="rtl"
            />
            {kind === "percent" ? (
              <TextField
                label={t("loyalty.percent")}
                type="number"
                min={1}
                max={100}
                value={percent}
                onChange={(e) => setPercent(e.target.value)}
                error={err["percentBasisPoints"]}
                data-testid="promo-percent"
              />
            ) : (
              <TextField
                label={t("loyalty.amount")}
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                error={err["amountFils"]}
                data-testid="promo-amount"
              />
            )}
            <TextField
              label={t("loyalty.cap")}
              inputMode="decimal"
              value={cap}
              onChange={(e) => setCap(e.target.value)}
              error={err["maxDiscountFils"]}
              hint={t("loyalty.optional")}
            />
            <TextField
              label={t("loyalty.minimum")}
              inputMode="decimal"
              value={minimum}
              onChange={(e) => setMinimum(e.target.value)}
              error={err["minSubtotalFils"]}
            />
            <TextField
              label={t("loyalty.maxUses")}
              type="number"
              min={1}
              value={maxUses}
              onChange={(e) => setMaxUses(e.target.value)}
              error={err["maxRedemptions"]}
              hint={t("loyalty.optional")}
            />
            <TextField
              label={t("loyalty.perCustomer")}
              type="number"
              min={1}
              max={100}
              value={perCustomer}
              onChange={(e) => setPerCustomer(e.target.value)}
              error={err["perCustomerLimit"]}
            />
            <span />
            <TextField
              label={t("loyalty.starts")}
              type="datetime-local"
              value={startsAt}
              onChange={(e) => setStartsAt(e.target.value)}
              error={err["startsAt"]}
            />
            <TextField
              label={t("loyalty.ends")}
              type="datetime-local"
              value={endsAt}
              onChange={(e) => setEndsAt(e.target.value)}
              error={err["endsAt"]}
              hint={t("loyalty.dubaiTime")}
            />
          </div>
        </>
      ) : null}
      <ActionError error={save.error ?? act.error} />
    </Dialog>
  );
}

// ── Tables ──────────────────────────────────────────────────────────────────

/** What the printed QR code opens: the customer app with the signed table token. */
function tableLink(token: string) {
  return `${customerAppUrl}/?table=${encodeURIComponent(token)}`;
}

function TablesTab() {
  const { t, locale } = useI18n();
  const branches = useBranches();
  const [branchId, setBranchId] = useState("");
  const chosen = branchId || branches.data?.[0]?.id || "";
  return (
    <QueryView query={branches}>
      {(list) =>
        list.length === 0 ? (
          <EmptyState title={t("loyalty.noBranches")} />
        ) : (
          <div className="stack">
            <SelectField
              label={t("filter.branch")}
              value={chosen}
              onChange={(e) => setBranchId(e.target.value)}
              options={list.map((b) => ({ value: b.id, label: branchName(b, locale) }))}
              data-testid="table-branch"
            />
            {(list.find((b) => b.id === chosen)?.modes ?? []).includes("dine_in") ? null : (
              <Banner tone="info">{t("loyalty.dineInOff")}</Banner>
            )}
            <BranchTables key={chosen} branchId={chosen} />
          </div>
        )
      }
    </QueryView>
  );
}

function BranchTables({ branchId }: { branchId: string }) {
  const { t } = useI18n();
  const api = useApi();
  const toast = useToast();
  const query = useQuery(
    async (signal) =>
      (
        await api.get(
          `/v1/merchant/branches/${branchId}/tables`,
          branchTableListResponseSchema,
          undefined,
          signal,
        )
      ).data,
    [branchId],
    { enabled: Boolean(branchId) },
  );
  const [label, setLabel] = useState("");
  const [confirm, setConfirm] = useState<{
    table: BranchTable;
    action: "rotate" | "retire";
  } | null>(null);
  const add = useAction(async () => {
    await api.post(`/v1/merchant/branches/${branchId}/tables`, branchTableResponseSchema, {
      label,
    });
    setLabel("");
    toast(t("loyalty.tableAdded"));
    query.reload();
  });
  const act = useAction(async (table: BranchTable, action: "rotate" | "retire") => {
    await api.post(
      `/v1/merchant/branches/${branchId}/tables/${table.id}/actions`,
      branchTableResponseSchema,
      { action },
    );
    toast(t(action === "rotate" ? "loyalty.rotated" : "loyalty.retired"));
    setConfirm(null);
    query.reload();
  });
  return (
    <Card title={t("loyalty.tables")}>
      <p className="muted">{t("loyalty.tablesHelp")}</p>
      <div className="row no-print">
        <TextField
          label={t("loyalty.tableLabel")}
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          error={add.error?.fieldErrors["label"]}
          data-testid="table-label"
        />
        <Button loading={add.pending} onClick={() => void add.run()} data-testid="add-table">
          {t("loyalty.addTable")}
        </Button>
        <Button variant="secondary" onClick={() => window.print()} data-testid="print-tables">
          {t("loyalty.print")}
        </Button>
      </div>
      <ActionError error={add.error} />
      <QueryView query={query}>
        {(tables) =>
          tables.length === 0 ? (
            <EmptyState title={t("loyalty.noTables")} />
          ) : (
            <div className="qr-grid">
              {tables.map((table) => (
                <div
                  key={table.id}
                  className={`qr-card${table.active ? "" : " no-print muted"}`}
                  data-testid={`table-${table.label}`}
                >
                  <strong className="qr-label">{table.label}</strong>
                  {table.active && table.token ? (
                    <QrImage
                      value={tableLink(table.token)}
                      alt={t("loyalty.qrAlt", { label: table.label })}
                    />
                  ) : (
                    <StatusChip tone="neutral">{t("loyalty.retiredChip")}</StatusChip>
                  )}
                  <span className="small muted">
                    {t("loyalty.codeVersion", { version: table.tokenVersion })}
                  </span>
                  {table.active ? (
                    <div className="row no-print">
                      <Button
                        variant="secondary"
                        onClick={() => setConfirm({ table, action: "rotate" })}
                        data-testid={`rotate-${table.label}`}
                      >
                        {t("loyalty.rotate")}
                      </Button>
                      <Button
                        variant="destructive"
                        onClick={() => setConfirm({ table, action: "retire" })}
                        data-testid={`retire-${table.label}`}
                      >
                        {t("loyalty.retire")}
                      </Button>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          )
        }
      </QueryView>
      <ConfirmDialog
        open={confirm !== null}
        title={confirm ? t(`loyalty.${confirm.action}`) : ""}
        body={
          <p>
            {confirm ? t(`loyalty.${confirm.action}Body`, { label: confirm.table.label }) : null}
          </p>
        }
        confirmLabel={confirm ? t(`loyalty.${confirm.action}`) : ""}
        destructive={confirm?.action === "retire"}
        onConfirm={() => confirm && void act.run(confirm.table, confirm.action)}
        onClose={() => setConfirm(null)}
        pending={act.pending}
        error={act.error}
      />
    </Card>
  );
}

function QrImage({ value, alt }: { value: string; alt: string }) {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    QRCode.toDataURL(value, { margin: 1, width: 240, errorCorrectionLevel: "M" })
      .then((url) => live && setSrc(url))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [value]);
  const { t } = useI18n();
  if (failed) return <Banner tone="error">{t("loyalty.qrFailed")}</Banner>;
  // eslint-disable-next-line @next/next/no-img-element
  return src ? <img src={src} alt={alt} width={180} height={180} className="qr-image" /> : null;
}
