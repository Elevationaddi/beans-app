"use client";
import {
  merchantOrderResponseSchema,
  arrivalResponseSchema,
  type MerchantOrder,
  type TransitionRequest,
} from "@beans/contracts";
import {
  ActionError,
  Button,
  ConfirmDialog,
  Dialog,
  StatusChip,
  TextField,
  formatFils,
  formatTime,
  useAction,
  useApi,
  useI18n,
  useToast,
} from "@beans/web";
import { useEffect, useState } from "react";
import { orderTone } from "./data";

/** Seconds left until `iso`, ticking every second; negative when past. */
export function useCountdown(iso: string | null): number | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!iso) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [iso]);
  return iso ? Math.round((new Date(iso).getTime() - now) / 1000) : null;
}

export function clock(seconds: number): string {
  const s = Math.abs(seconds);
  return `${seconds < 0 ? "-" : ""}${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function isDelayed(order: MerchantOrder): boolean {
  return (
    (order.status === "accepted" || order.status === "preparing") &&
    order.etaAt !== null &&
    new Date(order.etaAt).getTime() < Date.now()
  );
}

export function OrderLines({ order, large }: { order: MerchantOrder; large?: boolean }) {
  const { t, locale } = useI18n();
  return (
    <ul className={`order-lines${large ? " large" : ""}`}>
      {order.items.map((item, i) => (
        <li key={`${item.productId}-${i}`}>
          <strong>
            {item.quantity} × {item.names[locale] ?? item.names.en}
          </strong>
          {item.options.length ? (
            <span className="muted">
              {" "}
              · {item.options.map((o) => o.names[locale] ?? o.names.en).join(", ")}
            </span>
          ) : null}
          {item.notes ? (
            <p className="note" role="note">
              {t("orders.note")}: {item.notes}
            </p>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

/** One order with its timers and the next allowed step (the server enforces the state machine). */
export function OrderCard({
  order,
  onChanged,
  large,
  readOnly,
}: {
  order: MerchantOrder;
  onChanged: () => void;
  large?: boolean;
  /** Offline: show the cached order without any action (docs/05 T06). */
  readOnly?: boolean;
}) {
  const { t, locale } = useI18n();
  const acceptLeft = useCountdown(order.status === "received" ? order.acceptBy : null);
  const etaLeft = useCountdown(
    order.status === "accepted" || order.status === "preparing" ? order.etaAt : null,
  );
  const delayed = etaLeft !== null && etaLeft < 0;
  return (
    <article
      className={`order-card status-${order.status}${delayed ? " delayed" : ""}`}
      data-testid={`order-${order.publicNumber}`}
      aria-label={t("orders.orderNumber", { n: order.publicNumber })}
    >
      <header className="order-head">
        <h3>
          <bdi>#{order.publicNumber}</bdi>
        </h3>
        <StatusChip tone={orderTone[order.status]}>{t(`status.${order.status}`)}</StatusChip>
      </header>
      <div className="row small">
        <StatusChip tone="neutral">{t(`mode.${order.mode}`)}</StatusChip>
        <span>
          {order.asap
            ? t("orders.asap")
            : t("orders.scheduledFor", { time: formatTime(order.pickupAt, locale) })}
        </span>
        {acceptLeft !== null ? (
          <StatusChip tone={acceptLeft < 30 ? "error" : "warning"}>
            {t("orders.acceptWithin", { time: clock(Math.max(0, acceptLeft)) })}
          </StatusChip>
        ) : null}
        {etaLeft !== null ? (
          <StatusChip tone={delayed ? "error" : "info"}>
            {delayed
              ? t("orders.delayedBy", { time: clock(-etaLeft) })
              : t("orders.readyIn", { time: clock(etaLeft) })}
          </StatusChip>
        ) : null}
        {order.cancellationRequested ? (
          <StatusChip tone="error">{t("orders.cancelRequested")}</StatusChip>
        ) : null}
      </div>
      <OrderLines order={order} {...(large ? { large } : {})} />
      {order.mode === "curbside" && order.vehicle ? (
        <p className="vehicle" data-testid="vehicle">
          {t("orders.vehicle")}: <strong>{order.vehicle.plate}</strong>{" "}
          {order.vehicle.plateRegion ? `(${t(`city.${order.vehicle.plateRegion}`)})` : ""} ·{" "}
          {order.vehicle.color}
          {order.vehicle.model ? ` · ${order.vehicle.model}` : ""}
        </p>
      ) : null}
      {order.table ? (
        <p className="vehicle" data-testid="table">
          <strong>{t("benefit.table", { label: order.table.label })}</strong>
        </p>
      ) : null}
      {order.benefit ? (
        <p className="small" data-testid="benefit">
          <StatusChip tone="success">
            {order.benefit.kind === "promotion"
              ? t("benefit.promotion", { code: order.benefit.code })
              : t(`benefit.${order.benefit.kind}`)}
          </StatusChip>{" "}
          {t("benefit.discount")}: −{formatFils(order.benefit.discountFils, locale)}
        </p>
      ) : null}
      {order.arrival.arrivedAt ? (
        <p
          className={order.arrival.acknowledgedAt ? "arrival" : "arrival alert"}
          role={order.arrival.acknowledgedAt ? undefined : "alert"}
        >
          {order.arrival.acknowledgedAt
            ? t("orders.arrivalAcked", { time: formatTime(order.arrival.acknowledgedAt, locale) })
            : t("orders.arrived", { time: formatTime(order.arrival.arrivedAt, locale) })}
        </p>
      ) : null}
      {readOnly ? (
        <p className="muted small">{t("tablet.offlineActions")}</p>
      ) : (
        <OrderActions order={order} onChanged={onChanged} />
      )}
    </article>
  );
}

export function OrderActions({
  order,
  onChanged,
}: {
  order: MerchantOrder;
  onChanged: () => void;
}) {
  const { t } = useI18n();
  const api = useApi();
  const toast = useToast();
  const [dialog, setDialog] = useState<null | "accept" | "reject" | "complete">(null);
  const [eta, setEta] = useState("10");
  const [code, setCode] = useState("");
  const transition = useAction(async (body: TransitionRequest) => {
    await api.post(`/v1/merchant/orders/${order.id}/transition`, merchantOrderResponseSchema, body);
    toast(t(`orders.done.${body.action}`));
    setDialog(null);
    setCode("");
    onChanged();
  });
  const ack = useAction(async () => {
    await api.post(`/v1/merchant/orders/${order.id}/ack-arrival`, arrivalResponseSchema, {
      expectedVersion: order.version,
    });
    toast(t("orders.done.ack"));
    onChanged();
  });
  const v = order.version;
  // A stale version (another tablet acted first) answers 409: refresh to the server's state.
  useEffect(() => {
    if (transition.error?.status === 409 || ack.error?.status === 409) onChanged();
  }, [transition.error, ack.error, onChanged]);
  return (
    <div className="order-actions">
      {order.status === "received" ? (
        <>
          <Button size="lg" onClick={() => setDialog("accept")} data-testid="accept">
            {t("orders.accept")}
          </Button>
          <Button
            size="lg"
            variant="secondary"
            onClick={() => setDialog("reject")}
            data-testid="reject"
          >
            {t("orders.reject")}
          </Button>
        </>
      ) : null}
      {order.status === "accepted" ? (
        <Button
          size="lg"
          loading={transition.pending}
          onClick={() => void transition.run({ action: "start", expectedVersion: v })}
          data-testid="start"
        >
          {t("orders.start")}
        </Button>
      ) : null}
      {order.status === "preparing" ? (
        <Button
          size="lg"
          loading={transition.pending}
          onClick={() => void transition.run({ action: "ready", expectedVersion: v })}
          data-testid="ready"
        >
          {t("orders.markReady")}
        </Button>
      ) : null}
      {order.arrival.arrivedAt && !order.arrival.acknowledgedAt ? (
        <Button
          size="lg"
          variant="secondary"
          loading={ack.pending}
          onClick={() => void ack.run()}
          data-testid="ack-arrival"
        >
          {t("orders.ackArrival")}
        </Button>
      ) : null}
      {order.status === "ready" ? (
        <Button size="lg" onClick={() => setDialog("complete")} data-testid="complete">
          {t("orders.handOver")}
        </Button>
      ) : null}
      <ActionError error={transition.error && dialog === null ? transition.error : ack.error} />
      <Dialog
        open={dialog === "accept"}
        onClose={() => setDialog(null)}
        title={t("orders.acceptTitle", { n: order.publicNumber })}
        footer={
          <>
            <Button variant="secondary" onClick={() => setDialog(null)}>
              {t("common.cancel")}
            </Button>
            <Button
              loading={transition.pending}
              onClick={() =>
                void transition.run({
                  action: "accept",
                  expectedVersion: v,
                  etaMinutes: Number(eta),
                })
              }
              data-testid="confirm-accept"
            >
              {t("orders.accept")}
            </Button>
          </>
        }
      >
        <p>{t("orders.etaQuestion")}</p>
        <div className="row" role="radiogroup" aria-label={t("orders.eta")}>
          {["5", "10", "15", "20", "30"].map((m) => (
            <Button
              key={m}
              size="lg"
              variant={eta === m ? "primary" : "secondary"}
              aria-pressed={eta === m}
              onClick={() => setEta(m)}
            >
              {t("orders.minutes", { n: m })}
            </Button>
          ))}
        </div>
        <ActionError error={transition.error} />
      </Dialog>
      <ConfirmDialog
        open={dialog === "reject"}
        title={t("orders.rejectTitle", { n: order.publicNumber })}
        body={<p>{t("orders.rejectBody")}</p>}
        confirmLabel={t("orders.reject")}
        destructive
        requireReason
        reasonLabel={t("orders.rejectReason")}
        onConfirm={(reason) =>
          void transition.run({ action: "reject", expectedVersion: v, reason })
        }
        onClose={() => setDialog(null)}
        pending={transition.pending}
        error={transition.error}
      />
      <Dialog
        open={dialog === "complete"}
        onClose={() => setDialog(null)}
        title={t("orders.handOverTitle", { n: order.publicNumber })}
        footer={
          <>
            <Button variant="secondary" onClick={() => setDialog(null)}>
              {t("common.cancel")}
            </Button>
            <Button
              loading={transition.pending}
              disabled={!/^\d{6}$/.test(code)}
              onClick={() =>
                void transition.run({ action: "complete", expectedVersion: v, pickupCode: code })
              }
              data-testid="confirm-complete"
            >
              {t("orders.verifyAndHand")}
            </Button>
          </>
        }
      >
        <p>{t("orders.codeHelp")}</p>
        <TextField
          label={t("orders.pickupCode")}
          inputMode="numeric"
          autoComplete="off"
          pattern="\d{6}"
          maxLength={6}
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
          className="input code-input"
          data-testid="pickup-code"
        />
        <ActionError error={transition.error} />
      </Dialog>
    </div>
  );
}
