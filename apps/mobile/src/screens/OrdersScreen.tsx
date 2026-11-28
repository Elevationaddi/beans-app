import { Pressable, Text, View } from "react-native";
import { Body, Button, Heading, RemoteState, Screen, StatusChip, styles } from "../components/ui";
import { localized, useI18n } from "../i18n";
import { api, call } from "../lib/api";
import { dubaiTime } from "../lib/cart-sync";
import { formatFils } from "../lib/money";
import { useRemote } from "../lib/use-remote";
import type { TabScreen } from "../navigation/types";
import { useAppState } from "../state/app-state";
import { orderTone } from "./order-status";

const ACTIVE = ["pending_payment", "received", "accepted", "preparing", "ready"];

/** C08/C09: active orders first, then history. Refreshes while an order is open. */
export function OrdersScreen({ navigation }: TabScreen<"Orders">) {
  const { t, locale } = useI18n();
  const { signedIn } = useAppState();
  const orders = useRemote(
    async () =>
      signedIn
        ? (await call(api.GET("/v1/orders", { params: { query: { limit: 50 } } }))).data
        : [],
    [signedIn],
  );
  if (!signedIn) {
    return (
      <Screen testID="orders">
        <Heading>{t("tabs.orders")}</Heading>
        <Body>{t("orders.signIn")}</Body>
        <Button
          label={t("auth.signIn")}
          onPress={() => navigation.navigate("SignIn")}
          testID="orders-sign-in"
        />
      </Screen>
    );
  }
  return (
    <Screen testID="orders">
      <Heading>{t("tabs.orders")}</Heading>
      <Button label={t("common.refresh")} variant="secondary" onPress={orders.reload} />
      <RemoteState
        remote={orders}
        isEmpty={(list) => list.length === 0}
        empty={<Body>{t("orders.none")}</Body>}
      >
        {(list) => {
          const active = list.filter((o) => ACTIVE.includes(o.status));
          const past = list.filter((o) => !ACTIVE.includes(o.status));
          const row = (o: (typeof list)[number]) => (
            <Pressable
              key={o.id}
              accessibilityRole="button"
              accessibilityLabel={`${o.brandName}, ${t(`orderStatus.${o.status}`)}, ${formatFils(o.totalFils, locale)}`}
              onPress={() => navigation.navigate("Order", { orderId: o.id })}
              style={styles.card}
              testID={`order-row-${o.publicNumber}`}
            >
              <Text style={styles.h2}>{o.brandName}</Text>
              <Body>{localized(o.branchNames, locale)}</Body>
              <StatusChip label={t(`orderStatus.${o.status}`)} tone={orderTone[o.status]} />
              <Body muted>
                {`#${o.publicNumber} · ${formatFils(o.totalFils, locale)} · ${t("orders.pickupAt", { time: dubaiTime(o.pickupAt) })}`}
              </Body>
            </Pressable>
          );
          return (
            <View style={{ gap: 12 }}>
              {active.length ? <Heading level={2}>{t("orders.active")}</Heading> : null}
              {active.map(row)}
              {past.length ? <Heading level={2}>{t("orders.past")}</Heading> : null}
              {past.map(row)}
            </View>
          );
        }}
      </RemoteState>
    </Screen>
  );
}
