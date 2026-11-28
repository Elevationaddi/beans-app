"use client";
import {
  merchantBranchAvailabilityResponseSchema,
  merchantBranchListResponseSchema,
  merchantOrderListResponseSchema,
  branchOptionResponseSchema,
  branchProductResponseSchema,
  ticketListResponseSchema,
  ticketResponseSchema,
  type MerchantBranch,
  type MerchantOrder,
} from "@beans/contracts";
import {
  ActionError,
  Banner,
  Button,
  Card,
  EmptyState,
  LanguageToggle,
  LoadMore,
  Logo,
  QueryView,
  SelectField,
  StatusChip,
  Tabs,
  TextArea,
  TextField,
  formatDateTime,
  formatTime,
  useAction,
  useApi,
  useAuth,
  useEventStream,
  useI18n,
  useOnline,
  usePaged,
  useQuery,
  useToast,
  type StreamState,
} from "@beans/web";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { branchName, orderTone } from "../../lib/data";
import { OrderCard, isDelayed } from "../../lib/orders";

const BRANCH_KEY = "cm.tablet.branch";
type Tab = "new" | "preparing" | "scheduled" | "ready" | "completed" | "issues";

function readBranch(): string | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage.getItem(BRANCH_KEY);
  } catch {
    return null;
  }
}

/** T01: choose one of the branches this person is assigned to, then run its queue. */
export default function TabletPage() {
  const { t, locale } = useI18n();
  const api = useApi();
  const [branchId, setBranchId] = useState<string | null>(readBranch);
  const branches = useQuery(
    async (signal) =>
      (
        await api.get(
          "/v1/merchant/branches",
          merchantBranchListResponseSchema,
          { limit: 100 },
          signal,
        )
      ).data,
    [],
  );
  const choose = (id: string | null) => {
    setBranchId(id);
    try {
      if (id) window.sessionStorage.setItem(BRANCH_KEY, id);
      else window.sessionStorage.removeItem(BRANCH_KEY);
    } catch {
      // Storage blocked: the choice lasts for this page only.
    }
  };
  // Only open or paused branches the person may operate (docs/05 T01: wrong branch denied).
  const usable = (branches.data ?? []).filter(
    (b) => b.status === "active" || b.status === "paused",
  );
  const branch = usable.find((b) => b.id === branchId) ?? null;
  if (branch) return <Board branch={branch} onChangeBranch={() => choose(null)} />;
  return (
    <div className="tablet">
      <TabletBar title={t("tablet.chooseBranch")} />
      <main id="main" className="tablet-main">
        <QueryView query={branches}>
          {() =>
            usable.length === 0 ? (
              <EmptyState title={t("tablet.noBranches")} body={t("tablet.noBranchesBody")} />
            ) : (
              <div className="branch-choice" role="list">
                {usable.map((b) => (
                  <button
                    key={b.id}
                    role="listitem"
                    className="branch-tile"
                    onClick={() => choose(b.id)}
                    data-testid={`tablet-branch-${b.nameEn}`}
                  >
                    <strong>{branchName(b, locale)}</strong>
                    <span className="muted">{b.address}</span>
                    <StatusChip tone={b.status === "active" ? "success" : "warning"}>
                      {t(`branchStatus.${b.status}`)}
                    </StatusChip>
                  </button>
                ))}
              </div>
            )
          }
        </QueryView>
      </main>
    </div>
  );
}

function TabletBar({ title, children }: { title: string; children?: React.ReactNode }) {
  const { t } = useI18n();
  const { profile, signOut } = useAuth();
  return (
    <header className="tablet-bar">
      <Logo surface="tablet" />
      <h1 className="tablet-title">{title}</h1>
      <div className="row">
        {children}
        <LanguageToggle />
        <span className="small">{profile?.displayName ?? profile?.email}</span>
        <Button variant="ghost" onClick={() => void signOut()}>
          {t("common.signOut")}
        </Button>
      </div>
    </header>
  );
}

const STREAM_TONE: Record<StreamState, "success" | "warning" | "error"> = {
  live: "success",
  connecting: "warning",
  reconnecting: "warning",
  offline: "error",
};

/** T02–T06 for one branch: live queue with alerts, timers and every next step. */
function Board({ branch, onChangeBranch }: { branch: MerchantBranch; onChangeBranch: () => void }) {
  const { t, locale } = useI18n();
  const api = useApi();
  const online = useOnline();
  const [tab, setTab] = useState<Tab>("new");
  const live = useQuery(
    async (signal) =>
      (
        await api.get(
          "/v1/merchant/orders",
          merchantOrderListResponseSchema,
          { branchId: branch.id, limit: 100 },
          signal,
        )
      ).data,
    [branch.id],
    { pollMs: 15_000 },
  );
  const reload = live.reload;
  const stream = useEventStream(
    `/v1/merchant/branches/${branch.id}/order-events`,
    () => reload(),
    reload,
  );
  const all = useMemo(() => live.data ?? [], [live.data]);
  const now = useNow(30_000);
  const groups = useMemo(() => {
    // Scheduled orders wait in their own queue until 30 minutes before pickup.
    const later = (o: MerchantOrder) =>
      !o.asap && o.pickupAt !== null && new Date(o.pickupAt).getTime() - now > 30 * 60_000;
    return {
      new: all.filter((o) => o.status === "received"),
      preparing: all.filter(
        (o) => (o.status === "accepted" || o.status === "preparing") && !later(o),
      ),
      scheduled: all.filter(
        (o) => (o.status === "accepted" || o.status === "preparing") && later(o),
      ),
      ready: all.filter((o) => o.status === "ready"),
      delayed: all.filter(isDelayed),
      waiting: all.filter((o) => o.arrival.arrivedAt && !o.arrival.acknowledgedAt),
    };
  }, [all, now]);
  const alert = useNewOrderAlert(
    groups.new.map((o) => o.id).concat(groups.waiting.map((o) => `arr-${o.id}`)),
  );
  const readOnly = !online;

  const cards = (orders: MerchantOrder[], empty: string) =>
    orders.length === 0 ? (
      <EmptyState title={empty} />
    ) : (
      <div className="order-grid tablet-grid">
        {orders.map((o) => (
          <OrderCard key={o.id} order={o} onChanged={reload} large readOnly={readOnly} />
        ))}
      </div>
    );

  return (
    <div className={`tablet${alert.flashing ? " flash" : ""}`}>
      <TabletBar title={branchName(branch, locale)}>
        <StatusChip tone={STREAM_TONE[online ? stream : "offline"]}>
          <span data-testid="stream-state">{t(`stream.${online ? stream : "offline"}`)}</span>
        </StatusChip>
        <Button
          variant={alert.sound ? "secondary" : "primary"}
          onClick={alert.toggleSound}
          aria-pressed={alert.sound}
          data-testid="sound-toggle"
        >
          {alert.sound ? t("tablet.soundOn") : t("tablet.soundOff")}
        </Button>
        <Button variant="ghost" onClick={onChangeBranch}>
          {t("tablet.changeBranch")}
        </Button>
      </TabletBar>
      <main id="main" className="tablet-main">
        {!online ? <Banner tone="error">{t("tablet.offline")}</Banner> : null}
        {online && stream !== "live" ? <Banner tone="warning">{t("tablet.notLive")}</Banner> : null}
        {branch.status === "paused" ? <Banner tone="warning">{t("tablet.paused")}</Banner> : null}
        {live.stale ? <Banner tone="warning">{t("common.stale")}</Banner> : null}
        {groups.waiting.length > 0 ? (
          <Banner tone="warning">
            <span role="alert">{t("tablet.customersWaiting", { n: groups.waiting.length })}</span>
          </Banner>
        ) : null}
        <Tabs
          label={t("tablet.queue")}
          value={tab}
          onChange={setTab}
          tabs={[
            { value: "new", label: t("tablet.tab.new"), count: groups.new.length },
            {
              value: "preparing",
              label: t("tablet.tab.preparing"),
              count: groups.preparing.length,
            },
            {
              value: "scheduled",
              label: t("tablet.tab.scheduled"),
              count: groups.scheduled.length,
            },
            { value: "ready", label: t("tablet.tab.ready"), count: groups.ready.length },
            { value: "completed", label: t("tablet.tab.completed") },
            { value: "issues", label: t("tablet.tab.issues"), count: groups.delayed.length },
          ]}
        />
        {tab === "completed" ? (
          <Completed branchId={branch.id} />
        ) : tab === "issues" ? (
          <Issues branch={branch} delayed={groups.delayed} readOnly={readOnly} onChanged={reload} />
        ) : (
          <QueryView query={live}>
            {() =>
              tab === "new"
                ? cards(groups.new, t("tablet.empty.new"))
                : tab === "preparing"
                  ? cards(groups.preparing, t("tablet.empty.preparing"))
                  : tab === "scheduled"
                    ? cards(groups.scheduled, t("tablet.empty.scheduled"))
                    : cards(groups.ready, t("tablet.empty.ready"))
            }
          </QueryView>
        )}
      </main>
    </div>
  );
}

/** The current time, refreshed every `ms` so time-based queues move on their own. */
function useNow(ms: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), ms);
    return () => window.clearInterval(timer);
  }, [ms]);
  return now;
}

/**
 * Sound and visual alert when a new order or a customer arrival appears (docs/05 T02).
 * Browsers only play sound after a tap, so sound starts off until the barista turns it on.
 */
function useNewOrderAlert(keys: string[]) {
  const [sound, setSound] = useState(false);
  const [flashing, setFlashing] = useState(false);
  const seen = useRef<Set<string> | null>(null);
  const audio = useRef<AudioContext | null>(null);
  const beep = useCallback(() => {
    const ctx = audio.current;
    if (!ctx) return;
    for (const [i, freq] of [880, 1320].entries()) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.2, ctx.currentTime + i * 0.25);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.25 + 0.22);
      osc.connect(gain).connect(ctx.destination);
      osc.start(ctx.currentTime + i * 0.25);
      osc.stop(ctx.currentTime + i * 0.25 + 0.25);
    }
  }, []);
  const key = keys.join(",");
  useEffect(() => {
    const current = new Set(key ? key.split(",") : []);
    const previous = seen.current;
    seen.current = current;
    // The first load is not an alert; only orders that appear afterwards are.
    if (!previous || ![...current].some((k) => !previous.has(k))) return;
    if (sound) beep();
    const start = window.setTimeout(() => setFlashing(true), 0);
    const stop = window.setTimeout(() => setFlashing(false), 4000);
    return () => {
      window.clearTimeout(start);
      window.clearTimeout(stop);
    };
  }, [key, sound, beep]);
  const toggleSound = () => {
    if (!sound) {
      const Ctx =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (Ctx && !audio.current) audio.current = new Ctx();
      void audio.current?.resume();
      setSound(true);
      beep();
    } else {
      setSound(false);
    }
  };
  return { sound, flashing, toggleSound };
}

/** T05: recent finished orders, read only, with search by order number. */
function Completed({ branchId }: { branchId: string }) {
  const { t, locale } = useI18n();
  const api = useApi();
  const [status, setStatus] = useState<"completed" | "rejected" | "cancelled" | "expired">(
    "completed",
  );
  const [search, setSearch] = useState("");
  const list = usePaged(
    (cursor, signal) =>
      api.get(
        "/v1/merchant/orders",
        merchantOrderListResponseSchema,
        { branchId, status, cursor, limit: 25 },
        signal,
      ),
    [branchId, status],
  );
  const shown = list.items.filter((o) =>
    o.publicNumber.toLowerCase().includes(search.trim().toLowerCase()),
  );
  return (
    <div className="stack">
      <div className="filter-bar">
        <SelectField
          label={t("menu.status")}
          value={status}
          onChange={(e) => setStatus(e.target.value as typeof status)}
          options={(["completed", "rejected", "cancelled", "expired"] as const).map((s) => ({
            value: s,
            label: t(`status.${s}`),
          }))}
        />
        <TextField
          label={t("tablet.search")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          inputMode="search"
          data-testid="completed-search"
        />
      </div>
      <ActionError error={list.error} />
      {shown.length === 0 && !list.loading ? (
        <EmptyState title={t("orders.noHistory")} />
      ) : (
        <ul className="history-list">
          {shown.map((o) => (
            <li key={o.id} className="history-row">
              <strong>
                <bdi>#{o.publicNumber}</bdi>
              </strong>
              <StatusChip tone={orderTone[o.status]}>{t(`status.${o.status}`)}</StatusChip>
              <span>{t(`mode.${o.mode}`)}</span>
              <span className="muted">{formatDateTime(o.createdAt, locale)}</span>
              <span className="muted">
                {o.items.map((i) => `${i.quantity}× ${i.names[locale] ?? i.names.en}`).join(", ")}
              </span>
            </li>
          ))}
        </ul>
      )}
      <LoadMore hasMore={list.hasMore} loading={list.loading} onMore={() => void list.more()} />
    </div>
  );
}

/** T06: delayed orders, items running out, and reporting a problem to the manager. */
function Issues({
  branch,
  delayed,
  readOnly,
  onChanged,
}: {
  branch: MerchantBranch;
  delayed: MerchantOrder[];
  readOnly: boolean;
  onChanged: () => void;
}) {
  const { t } = useI18n();
  return (
    <div className="stack">
      <Card title={t("tablet.delayed")}>
        {delayed.length === 0 ? (
          <p className="muted">{t("tablet.noDelayed")}</p>
        ) : (
          <div className="order-grid tablet-grid">
            {delayed.map((o) => (
              <OrderCard key={o.id} order={o} onChanged={onChanged} large readOnly={readOnly} />
            ))}
          </div>
        )}
      </Card>
      <SoldOut branchId={branch.id} readOnly={readOnly} />
      <ReportIssue branch={branch} readOnly={readOnly} />
    </div>
  );
}

function SoldOut({ branchId, readOnly }: { branchId: string; readOnly: boolean }) {
  const { t, locale } = useI18n();
  const api = useApi();
  const toast = useToast();
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
  );
  const toggle = useAction(async (kind: "products" | "options", id: string, soldOut: boolean) => {
    const schema = kind === "products" ? branchProductResponseSchema : branchOptionResponseSchema;
    await api.post(`/v1/merchant/branches/${branchId}/${kind}/${id}/sold-out`, schema, { soldOut });
    toast(soldOut ? t("tablet.markedSoldOut") : t("tablet.markedAvailable"));
    query.reload();
  });
  return (
    <Card title={t("tablet.soldOut")}>
      <p className="muted small">{t("tablet.soldOutHint")}</p>
      <ActionError error={toggle.error} />
      <QueryView query={query}>
        {(d) => (
          <div className="stack">
            <ul className="toggle-list" aria-label={t("menu.products")}>
              {d.products
                .filter((p) => p.productStatus === "published")
                .map((p) => (
                  <li key={p.productId} className={p.enabled ? "" : "is-off"}>
                    <span>{p.names[locale] ?? p.names.en}</span>
                    <Button
                      variant={p.enabled ? "secondary" : "primary"}
                      disabled={readOnly}
                      loading={toggle.pending}
                      onClick={() => void toggle.run("products", p.productId, p.enabled)}
                      data-testid={`soldout-${p.names.en}`}
                    >
                      {p.enabled ? t("availability.markSoldOut") : t("availability.markAvailable")}
                    </Button>
                  </li>
                ))}
            </ul>
            {d.options.length ? (
              <ul className="toggle-list" aria-label={t("menu.options")}>
                {d.options.map((o) => (
                  <li key={o.optionId} className={o.enabled ? "" : "is-off"}>
                    <span>
                      {o.names[locale] ?? o.names.en}{" "}
                      <span className="muted small">
                        · {o.groupNames[locale] ?? o.groupNames.en}
                      </span>
                    </span>
                    <Button
                      variant={o.enabled ? "secondary" : "primary"}
                      disabled={readOnly}
                      loading={toggle.pending}
                      onClick={() => void toggle.run("options", o.optionId, o.enabled)}
                    >
                      {o.enabled ? t("availability.markSoldOut") : t("availability.markAvailable")}
                    </Button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        )}
      </QueryView>
    </Card>
  );
}

function ReportIssue({ branch, readOnly }: { branch: MerchantBranch; readOnly: boolean }) {
  const { t, locale } = useI18n();
  const api = useApi();
  const toast = useToast();
  const [category, setCategory] = useState<"order_issue" | "other">("other");
  const [orderId, setOrderId] = useState("");
  const [message, setMessage] = useState("");
  const recent = useQuery(
    async (signal) =>
      (
        await api.get(
          "/v1/merchant/orders",
          merchantOrderListResponseSchema,
          { branchId: branch.id, status: "completed", limit: 20 },
          signal,
        )
      ).data,
    [branch.id],
  );
  const mine = usePaged(
    (cursor, signal) =>
      api.get(
        "/v1/tickets",
        ticketListResponseSchema,
        { merchantId: branch.merchantId, cursor, limit: 10 },
        signal,
      ),
    [branch.merchantId],
  );
  const send = useAction(async () => {
    await api.post("/v1/tickets", ticketResponseSchema, {
      category,
      merchantId: branch.merchantId,
      message: `[${branchName(branch, "en")}] ${message.trim()}`,
      ...(orderId ? { orderId } : {}),
    });
    setMessage("");
    setOrderId("");
    toast(t("tablet.reported"));
    mine.reload();
  });
  return (
    <Card title={t("tablet.report")}>
      <p className="muted small">{t("tablet.reportHint")}</p>
      <SelectField
        label={t("support.category")}
        value={category}
        onChange={(e) => setCategory(e.target.value as typeof category)}
        options={[
          { value: "other", label: t("tablet.issue.other") },
          { value: "order_issue", label: t("tablet.issue.order") },
        ]}
      />
      <SelectField
        label={t("support.order")}
        value={orderId}
        onChange={(e) => setOrderId(e.target.value)}
        options={[
          { value: "", label: t("support.noOrder") },
          ...(recent.data ?? []).map((o) => ({
            value: o.id,
            label: `#${o.publicNumber} · ${formatTime(o.createdAt, locale)}`,
          })),
        ]}
      />
      <TextArea
        label={t("support.message")}
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        rows={3}
        maxLength={3500}
        data-testid="issue-message"
      />
      <ActionError error={send.error} />
      <Button
        onClick={() => void send.run()}
        disabled={readOnly || !message.trim()}
        loading={send.pending}
        data-testid="issue-send"
      >
        {t("tablet.sendReport")}
      </Button>
      <h3>{t("tablet.myReports")}</h3>
      {mine.items.length === 0 ? (
        <p className="muted">{t("tablet.noReports")}</p>
      ) : (
        <ul className="history-list">
          {mine.items.map((r) => (
            <li key={r.id} className="history-row">
              <span>{t(`ticketCategory.${r.category}`)}</span>
              <StatusChip tone={r.status === "open" ? "warning" : "success"}>
                {t(`ticketStatus.${r.status}`)}
              </StatusChip>
              <span className="muted">{formatDateTime(r.createdAt, locale)}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
