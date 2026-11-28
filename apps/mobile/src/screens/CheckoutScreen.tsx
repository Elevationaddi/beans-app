import type { Quote } from "@beans/contracts";
import { useState } from "react";
import { Linking, View } from "react-native";
import {
  Body,
  Button,
  Chip,
  FailureText,
  Field,
  Heading,
  Notice,
  RemoteState,
  Screen,
  styles,
} from "../components/ui";
import { localized, useI18n } from "../i18n";
import { newIdempotencyKey } from "../lib/session";
import { api, call } from "../lib/api";
import { dubaiDate, dubaiTime, syncCart } from "../lib/cart-sync";
import { formatFils } from "../lib/money";
import { usePlatformStatus } from "../lib/platform";
import { useAction } from "../lib/use-action";
import { useRemote } from "../lib/use-remote";
import type { RootScreen } from "../navigation/types";
import { useAppState } from "../state/app-state";
import { useTable } from "../lib/table";

type Mode = "in_store" | "curbside" | "dine_in";
/** At most one saving per order; the server works out the amount. */
type Saving =
  { kind: "promo"; code: string } | { kind: "reward"; id: string } | { kind: "gift"; id: string };

/**
 * C07: pickup type, vehicle for curbside, pickup time (as soon as possible or a slot), the
 * server's quote, and payment. Sandbox build: the fake provider takes no card details and no
 * money moves; a declined card can be simulated to test the failure path.
 */
export function CheckoutScreen({ navigation }: RootScreen<"Checkout">) {
  const { t, locale } = useI18n();
  const { cart, clearCart } = useAppState();
  const platform = usePlatformStatus();
  const table = useTable();
  const atTable = table !== null && table.branchId === cart.branchId;
  const [mode, setMode] = useState<Mode>(atTable ? "dine_in" : "in_store");
  const [saving, setSaving] = useState<Saving | null>(null);
  const [promo, setPromo] = useState("");
  const [vehicleId, setVehicleId] = useState<string | null>(null);
  const [slotId, setSlotId] = useState<string | null>(null);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [declined, setDeclined] = useState(false);

  const setup = useRemote(async () => {
    const branchId = cart.branchId;
    if (!branchId) throw new Error("Empty cart");
    const [serverCart, branch, vehicles] = await Promise.all([
      syncCart(cart),
      call(api.GET("/v1/branches/{id}", { params: { path: { id: branchId } } })),
      call(api.GET("/v1/vehicles")),
    ]);
    // Stamps and gifts are optional extras: if either feature is off, checkout still works.
    const [stamps, gifts] = await Promise.all([
      call(api.GET("/v1/me/stamps")).then(
        (r) => r.data,
        () => [],
      ),
      call(api.GET("/v1/gifts")).then(
        (r) => r.data,
        () => [],
      ),
    ]);
    const merchantId = branch.data.merchantId;
    return {
      serverCart,
      branch: branch.data,
      vehicles: vehicles.data,
      reward:
        stamps.find((s) => s.merchantId === merchantId && s.rewardAvailable && s.card) ?? null,
      gifts: gifts.filter(
        (g) => g.role === "received" && g.status === "claimed" && g.merchantId === merchantId,
      ),
    };
    // The cart is synced once when the screen opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const slots = useRemote(async () => {
    if (!cart.branchId) return [];
    const result = await call(
      api.GET("/v1/branches/{id}/slots", {
        params: { path: { id: cart.branchId }, query: { date: dubaiDate(), mode } },
      }),
    );
    return result.data.slots.filter((s) => s.available).slice(0, 12);
  }, [cart.branchId, mode]);

  const review = useAction(async () => {
    const server = setup.data?.serverCart;
    // While the cart is being copied again (after a decline) the old server cart is spent.
    if (!server || setup.loading) return;
    setDeclined(false);
    const result = await call(
      api.POST("/v1/quotes", {
        body: {
          cartId: server.id,
          cartVersion: server.version,
          mode,
          ...(slotId && { slotId }),
          ...(mode === "curbside" && vehicleId && { vehicleId }),
          ...(mode === "dine_in" && table && { tableToken: table.token }),
          ...(saving?.kind === "promo" && { promoCode: saving.code }),
          ...(saving?.kind === "reward" && { rewardId: saving.id }),
          ...(saving?.kind === "gift" && { giftId: saving.id }),
        },
      }),
    );
    setQuote(result.data);
  });

  const pay = useAction(async (outcome: "succeed" | "fail") => {
    if (!quote) return;
    const result = await call(
      api.POST("/v1/checkout", {
        params: { header: { "Idempotency-Key": newIdempotencyKey() } },
        body: { quoteId: quote.id, sandboxOutcome: outcome },
      }),
    );
    if (result.data.payment.status === "failed") {
      // The declined attempt used up the server cart (it became a payment_failed order), so
      // copy the cart on the device to a fresh server cart before the next quote.
      setDeclined(true);
      setQuote(null);
      setup.reload();
      return;
    }
    clearCart();
    const action = result.data.payment.clientAction;
    if (action.type === "redirect") {
      // The provider's hosted page (Tap) takes the card; the app never sees card details.
      // The order screen keeps checking until the provider confirms the payment.
      await Linking.openURL(action.url);
    }
    navigation.replace("Order", { orderId: result.data.orderId });
  });

  const paused = platform.data?.ordersPaused === true;
  return (
    <Screen testID="checkout">
      <Heading>{t("checkout.title")}</Heading>
      {paused ? (
        <Notice tone="error" testID="paused">
          {platform.data?.message ? localized(platform.data.message, locale) : t("checkout.paused")}
        </Notice>
      ) : null}
      <RemoteState remote={setup}>
        {({ serverCart, branch, vehicles, reward, gifts }) => {
          const modes = branch.modes.filter(
            (m): m is Mode => m === "in_store" || m === "curbside" || (m === "dine_in" && atTable),
          );
          const choose = (next: Saving | null) => {
            setSaving(next);
            setQuote(null);
          };
          const needsVehicle = mode === "curbside" && !vehicleId;
          return (
            <View style={{ gap: 12 }}>
              <Body muted>{`${branch.brandName} · ${localized(branch.names, locale)}`}</Body>
              {serverCart.items
                .filter((i) => i.issue)
                .map((i) => (
                  <Notice key={i.id} tone="warning">
                    {t("checkout.lineIssue", { name: i.names ? localized(i.names, locale) : "" })}
                  </Notice>
                ))}

              <Heading level={2}>{t("checkout.pickup")}</Heading>
              <View style={styles.row} accessibilityRole="radiogroup">
                {modes.map((m) => (
                  <Chip
                    key={m}
                    role="radio"
                    label={t(`explore.mode.${m}`)}
                    selected={mode === m}
                    onPress={() => {
                      setMode(m);
                      setQuote(null);
                      setSlotId(null);
                    }}
                    testID={`mode-${m}`}
                  />
                ))}
              </View>

              {mode === "curbside" ? (
                <View style={{ gap: 8 }}>
                  <Heading level={2}>{t("checkout.vehicle")}</Heading>
                  {vehicles.length === 0 ? <Body>{t("checkout.noVehicle")}</Body> : null}
                  <View style={styles.row} accessibilityRole="radiogroup">
                    {vehicles.map((v) => (
                      <Chip
                        key={v.id}
                        role="radio"
                        label={[v.color, v.model, v.plate].filter(Boolean).join(" · ")}
                        selected={vehicleId === v.id}
                        onPress={() => {
                          setVehicleId(v.id);
                          setQuote(null);
                        }}
                        testID={`vehicle-${v.plate}`}
                      />
                    ))}
                  </View>
                  <Button
                    label={t("checkout.manageVehicles")}
                    variant="secondary"
                    onPress={() => navigation.navigate("Vehicles")}
                  />
                </View>
              ) : null}

              {mode === "dine_in" && table ? (
                <Notice tone="info" testID="checkout-table">
                  {t("checkout.toTable", { label: table.label })}
                </Notice>
              ) : null}

              <Heading level={2}>{t("checkout.savings")}</Heading>
              <View style={styles.row} accessibilityRole="radiogroup">
                <Chip
                  role="radio"
                  label={t("checkout.noSaving")}
                  selected={saving === null}
                  onPress={() => choose(null)}
                  testID="saving-none"
                />
                {reward?.card ? (
                  <Chip
                    role="radio"
                    label={t("checkout.useReward", {
                      reward: localized(reward.card.reward, locale),
                    })}
                    selected={saving?.kind === "reward"}
                    onPress={() => choose({ kind: "reward", id: reward.card!.id })}
                    testID="saving-reward"
                  />
                ) : null}
                {gifts.map((g) => (
                  <Chip
                    key={g.id}
                    role="radio"
                    label={t("checkout.useGift", { name: localized(g.productNames, locale) })}
                    selected={saving?.kind === "gift" && saving.id === g.id}
                    onPress={() => choose({ kind: "gift", id: g.id })}
                    testID={`saving-gift-${g.id}`}
                  />
                ))}
              </View>
              <Field
                label={t("checkout.promoCode")}
                value={promo}
                onChangeText={(v) => {
                  setPromo(v.toUpperCase());
                  if (saving?.kind === "promo") choose(null);
                }}
                autoCapitalize="characters"
                autoCorrect={false}
                testID="promo-code"
              />
              <Button
                label={
                  saving?.kind === "promo" ? t("checkout.promoApplied") : t("checkout.applyPromo")
                }
                variant="secondary"
                disabled={promo.trim().length < 3 || saving?.kind === "promo"}
                onPress={() => choose({ kind: "promo", code: promo.trim() })}
                testID="apply-promo"
              />

              <Heading level={2}>{t("checkout.when")}</Heading>
              <View style={styles.row} accessibilityRole="radiogroup">
                <Chip
                  role="radio"
                  label={t("checkout.asap")}
                  selected={slotId === null}
                  disabled={branch.availability !== "open"}
                  onPress={() => {
                    setSlotId(null);
                    setQuote(null);
                  }}
                  testID="slot-asap"
                />
                {(slots.data ?? []).map((s) => (
                  <Chip
                    key={s.id}
                    role="radio"
                    label={dubaiTime(s.startsAt)}
                    selected={slotId === s.id}
                    onPress={() => {
                      setSlotId(s.id);
                      setQuote(null);
                    }}
                  />
                ))}
              </View>
              {branch.availability !== "open" && slotId === null ? (
                <Body>{t("checkout.chooseSlot")}</Body>
              ) : null}

              {quote ? (
                <View style={styles.card} testID="quote">
                  <Heading level={2}>{t("checkout.summary")}</Heading>
                  {quote.lines.map((l) => (
                    <Body key={l.cartItemId}>
                      {`${l.quantity} × ${localized(l.names, locale)} · ${formatFils(l.lineFils, locale)}`}
                    </Body>
                  ))}
                  <Body>{`${t("checkout.subtotal")}: ${formatFils(quote.subtotalFils, locale)}`}</Body>
                  {quote.discountFils !== "0" ? (
                    <Body testID="quote-discount">{`${
                      quote.benefit?.kind === "promotion"
                        ? t("checkout.discountCode", { code: quote.benefit.code })
                        : quote.benefit?.kind === "reward"
                          ? t("checkout.discountReward")
                          : quote.benefit?.kind === "gift"
                            ? t("checkout.discountGift")
                            : t("checkout.discount")
                    }: -${formatFils(quote.discountFils, locale)}`}</Body>
                  ) : null}
                  {quote.fulfillment.table ? (
                    <Body>{t("checkout.toTable", { label: quote.fulfillment.table.label })}</Body>
                  ) : null}
                  <Body muted>
                    {t("checkout.vatIncluded", {
                      amount: formatFils(quote.taxIncludedFils, locale),
                    })}
                  </Body>
                  <Heading
                    level={2}
                  >{`${t("checkout.total")}: ${formatFils(quote.totalFils, locale)}`}</Heading>
                  <Body muted>
                    {t("checkout.pickupAt", { time: dubaiTime(quote.fulfillment.pickupAt) })}
                  </Body>
                  <Notice tone="info">{t("checkout.sandbox")}</Notice>
                  <Button
                    label={t("checkout.pay", { total: formatFils(quote.totalFils, locale) })}
                    onPress={() => void pay.run("succeed")}
                    disabled={pay.pending || paused}
                    testID="pay"
                  />
                  <Button
                    label={t("checkout.simulateDecline")}
                    variant="secondary"
                    onPress={() => void pay.run("fail")}
                    disabled={pay.pending || paused}
                    testID="pay-decline"
                  />
                  <FailureText failure={pay.failure} />
                </View>
              ) : (
                <Button
                  label={t("checkout.review")}
                  onPress={() => void review.run()}
                  disabled={
                    review.pending ||
                    setup.loading ||
                    paused ||
                    !serverCart.canCheckout ||
                    needsVehicle ||
                    (branch.availability !== "open" && slotId === null)
                  }
                  testID="review"
                />
              )}
              {declined ? (
                <Notice tone="error" testID="declined">
                  {t("checkout.declined")}
                </Notice>
              ) : null}
              <FailureText failure={review.failure} />
            </View>
          );
        }}
      </RemoteState>
    </Screen>
  );
}
