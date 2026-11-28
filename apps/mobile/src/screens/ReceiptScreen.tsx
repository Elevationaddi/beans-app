import { View } from "react-native";
import { Body, Heading, RemoteState, Screen, styles } from "../components/ui";
import { localized, useI18n } from "../i18n";
import { api, call } from "../lib/api";
import { dubaiTime } from "../lib/cart-sync";
import { formatFils } from "../lib/money";
import { useRemote } from "../lib/use-remote";
import type { RootScreen } from "../navigation/types";

/** C10: receipt from the server (prices, VAT included and refunds as charged). */
export function ReceiptScreen({ route }: RootScreen<"Receipt">) {
  const { t, locale } = useI18n();
  const receipt = useRemote(
    async () =>
      (
        await call(
          api.GET("/v1/orders/{id}/receipt", { params: { path: { id: route.params.orderId } } }),
        )
      ).data,
    [route.params.orderId],
  );
  return (
    <Screen testID="receipt">
      <RemoteState remote={receipt}>
        {(r) => (
          <View style={{ gap: 8 }}>
            <Heading>{t("receipt.title")}</Heading>
            <Body>{r.brandName}</Body>
            <Body muted>{`${localized(r.branchNames, locale)} · ${r.branchAddress}`}</Body>
            <Body
              muted
            >{`#${r.publicNumber} · ${r.issuedAt.slice(0, 10)} ${dubaiTime(r.issuedAt)}`}</Body>
            <View style={styles.card}>
              {r.items.map((item, i) => (
                <Body
                  key={i}
                >{`${item.quantity} × ${localized(item.names, locale)} · ${formatFils(item.totalFils, locale)}`}</Body>
              ))}
            </View>
            <Body>{`${t("checkout.subtotal")}: ${formatFils(r.totals.subtotalFils, locale)}`}</Body>
            {r.totals.discountFils !== "0" ? (
              <Body>{`${t("checkout.discount")}: -${formatFils(r.totals.discountFils, locale)}`}</Body>
            ) : null}
            <Heading
              level={2}
            >{`${t("checkout.total")}: ${formatFils(r.totals.totalFils, locale)}`}</Heading>
            <Body muted>
              {t("checkout.vatIncluded", { amount: formatFils(r.totals.taxIncludedFils, locale) })}
            </Body>
            <Body>{`${t("receipt.paid")}: ${formatFils(r.paidFils, locale)}`}</Body>
            {r.refundedFils !== "0" ? (
              <Body>{`${t("receipt.refunded")}: ${formatFils(r.refundedFils, locale)}`}</Body>
            ) : null}
            <Body muted>{t("receipt.sandbox")}</Body>
          </View>
        )}
      </RemoteState>
    </Screen>
  );
}
