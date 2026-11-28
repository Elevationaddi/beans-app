import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import {
  Body,
  Button,
  FailureText,
  Field,
  Heading,
  Notice,
  RemoteState,
  Screen,
  StatusChip,
  styles,
} from "../components/ui";
import { localized, useI18n } from "../i18n";
import { newIdempotencyKey } from "../lib/session";
import { api, call } from "../lib/api";
import { dubaiTime } from "../lib/cart-sync";
import { formatFils } from "../lib/money";
import { useAction } from "../lib/use-action";
import { useRemote } from "../lib/use-remote";
import type { RootScreen } from "../navigation/types";
import { STEPS, orderTone } from "./order-status";

const OPEN = ["pending_payment", "received", "accepted", "preparing", "ready"];

/**
 * C08: live order tracking. Refreshes every 5 seconds while the order is open (the API also
 * offers a server-sent event stream; polling keeps this simple and works on every network).
 * Shows the pickup code, curbside check-in, cancellation request, refunds and the receipt.
 */
export function OrderScreen({ navigation, route }: RootScreen<"Order">) {
  const { t, locale } = useI18n();
  const { orderId } = route.params;
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState("");
  const order = useRemote(
    async () =>
      (await call(api.GET("/v1/orders/{id}", { params: { path: { id: orderId } } }))).data,
    [orderId],
  );
  const open = order.data ? OPEN.includes(order.data.status) : true;
  useEffect(() => {
    if (!open) return;
    const timer = setInterval(order.reload, 5000);
    return () => clearInterval(timer);
  }, [open, order.reload]);

  const arrive = useAction(async () => {
    const expectedVersion = order.data?.version ?? 1;
    await call(
      api.POST("/v1/orders/{id}/arrival", {
        params: {
          path: { id: orderId },
          header: { "Idempotency-Key": newIdempotencyKey() },
        },
        body: { expectedVersion },
      }),
    );
    order.reload();
  });
  const cancel = useAction(async () => {
    await call(
      api.POST("/v1/orders/{id}/cancel-requests", {
        params: {
          path: { id: orderId },
          header: { "Idempotency-Key": newIdempotencyKey() },
        },
        body: { reason: reason.trim() },
      }),
    );
    setAsking(false);
    order.reload();
  });

  return (
    <Screen testID="order">
      <RemoteState remote={order}>
        {(o) => {
          const stepIndex = STEPS.indexOf(o.status);
          return (
            <View style={{ gap: 12 }}>
              <Heading>{t("order.title", { number: o.publicNumber })}</Heading>
              <Body>{`${o.brandName} · ${localized(o.branchNames, locale)}`}</Body>
              <StatusChip label={t(`orderStatus.${o.status}`)} tone={orderTone[o.status]} />
              <Body testID="order-status-text">{t(`orderHint.${o.status}`)}</Body>

              {stepIndex >= 0 ? (
                <View
                  style={styles.card}
                  accessibilityRole="progressbar"
                  accessibilityLabel={t(`orderStatus.${o.status}`)}
                >
                  {STEPS.map((step, i) => (
                    <Body key={step} muted={i > stepIndex}>
                      {`${i <= stepIndex ? "●" : "○"} ${t(`orderStatus.${step}`)}`}
                    </Body>
                  ))}
                </View>
              ) : null}

              {o.etaAt && OPEN.includes(o.status) ? (
                <Body>{t("order.eta", { time: dubaiTime(o.etaAt) })}</Body>
              ) : (
                <Body muted>{t("orders.pickupAt", { time: dubaiTime(o.pickupAt) })}</Body>
              )}

              {o.pickupCode ? (
                <View style={styles.card} testID="pickup-code">
                  <Body>{t("order.code")}</Body>
                  <Text
                    style={[styles.h1, { letterSpacing: 6, textAlign: "center" }]}
                    accessibilityLabel={o.pickupCode.split("").join(" ")}
                  >
                    {o.pickupCode}
                  </Text>
                  <Body muted>{t("order.codeHint")}</Body>
                </View>
              ) : null}

              {o.mode === "curbside" && ["accepted", "preparing", "ready"].includes(o.status) ? (
                o.arrival.arrivedAt ? (
                  <Notice tone="success" testID="arrived">
                    {o.arrival.acknowledgedAt ? t("order.arrivalSeen") : t("order.arrivalSent")}
                  </Notice>
                ) : (
                  <>
                    <Button
                      label={t("order.arrived")}
                      onPress={() => void arrive.run()}
                      disabled={arrive.pending}
                      testID="arrive"
                    />
                    {o.fulfillment.vehicle ? (
                      <Body muted>
                        {[
                          o.fulfillment.vehicle.color,
                          o.fulfillment.vehicle.model,
                          o.fulfillment.vehicle.plate,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </Body>
                    ) : null}
                    <FailureText failure={arrive.failure} />
                  </>
                )
              ) : null}

              <Heading level={2}>{t("order.items")}</Heading>
              {o.items.map((item, i) => (
                <View key={i}>
                  <Body>{`${item.quantity} × ${localized(item.names, locale)} · ${formatFils(item.totalFils, locale)}`}</Body>
                  {item.options.length ? (
                    <Body muted>
                      {item.options.map((op) => localized(op.names, locale)).join(", ")}
                    </Body>
                  ) : null}
                  {item.notes ? <Body muted>{item.notes}</Body> : null}
                </View>
              ))}
              <Body>{`${t("checkout.total")}: ${formatFils(o.totals.totalFils, locale)}`}</Body>
              <Body muted>
                {t("checkout.vatIncluded", {
                  amount: formatFils(o.totals.taxIncludedFils, locale),
                })}
              </Body>

              {o.refunds.length ? (
                <View style={styles.card} testID="refunds">
                  <Heading level={2}>{t("order.refunds")}</Heading>
                  {o.refunds.map((r) => (
                    <Body
                      key={r.id}
                    >{`${formatFils(r.amountFils, locale)} · ${t(`refundStatus.${r.status}`)}`}</Body>
                  ))}
                </View>
              ) : null}

              {o.cancellationRequest ? (
                <Notice tone="warning" testID="cancel-request">
                  {`${t("order.cancelRequested")} · ${t(`cancelStatus.${o.cancellationRequest.status}`)}${o.cancellationRequest.resolutionReason ? ` · ${o.cancellationRequest.resolutionReason}` : ""}`}
                </Notice>
              ) : ["received", "accepted", "preparing"].includes(o.status) ? (
                asking ? (
                  <View style={styles.card}>
                    <Field
                      label={t("order.cancelReason")}
                      value={reason}
                      onChangeText={setReason}
                      multiline
                      maxLength={500}
                      testID="cancel-reason"
                    />
                    <Body muted>{t("order.cancelHint")}</Body>
                    <Button
                      label={t("order.sendCancel")}
                      variant="destructive"
                      onPress={() => void cancel.run()}
                      disabled={cancel.pending || reason.trim().length < 3}
                      testID="send-cancel"
                    />
                    <Button
                      label={t("common.cancel")}
                      variant="secondary"
                      onPress={() => setAsking(false)}
                    />
                    <FailureText failure={cancel.failure} />
                  </View>
                ) : (
                  <Button
                    label={t("order.askCancel")}
                    variant="secondary"
                    onPress={() => setAsking(true)}
                    testID="ask-cancel"
                  />
                )
              ) : null}

              {o.status === "completed" || o.refunds.length ? (
                <Button
                  label={t("order.receipt")}
                  variant="secondary"
                  onPress={() => navigation.navigate("Receipt", { orderId })}
                  testID="open-receipt"
                />
              ) : null}
              <Button
                label={t("order.help")}
                variant="secondary"
                onPress={() => navigation.navigate("Support", { orderId })}
              />
              <Body muted>{t("order.policy", { version: o.policyVersion })}</Body>
            </View>
          );
        }}
      </RemoteState>
    </Screen>
  );
}
