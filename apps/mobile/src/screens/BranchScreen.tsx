import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { availabilityText } from "../components/branch-card";
import { Body, Button, Heading, RemoteState, Screen, StatusChip, styles } from "../components/ui";
import { localized, useI18n } from "../i18n";
import { api, call } from "../lib/api";
import { formatFils } from "../lib/money";
import { useRemote } from "../lib/use-remote";
import type { RootScreen } from "../navigation/types";
import { useAppState } from "../state/app-state";
import { itemCount } from "../state/cart";

/** C04: branch details, hours in Dubai time, branch switcher, and the branch menu. */
export function BranchScreen({ navigation, route }: RootScreen<"Branch">) {
  const { t, locale } = useI18n();
  const { cart, signedIn } = useAppState();
  const { branchId } = route.params;
  const [showHours, setShowHours] = useState(false);
  const remote = useRemote(async () => {
    const path = { params: { path: { id: branchId } } };
    const [detail, menu] = await Promise.all([
      call(api.GET("/v1/branches/{id}", path)),
      call(api.GET("/v1/branches/{id}/menu", path)),
    ]);
    return { branch: detail.data, menu: menu.data };
  }, [branchId]);
  const count = itemCount(cart);

  return (
    <Screen testID="branch">
      <RemoteState remote={remote}>
        {({ branch, menu }) => (
          <View style={{ gap: 12 }}>
            <Heading>{branch.brandName}</Heading>
            <Body>{localized(branch.names, locale)}</Body>
            <StatusChip
              label={t(availabilityText[branch.availability])}
              tone={
                branch.availability === "open"
                  ? "success"
                  : branch.availability === "closed"
                    ? "warning"
                    : "error"
              }
            />
            {branch.availability === "closed" ? <Body>{t("availability.closedHint")}</Body> : null}
            {branch.availability === "paused" ? <Body>{t("availability.pausedHint")}</Body> : null}
            <Body muted>{branch.address}</Body>
            <View style={styles.row}>
              {branch.modes.map((m) => (
                <StatusChip key={m} label={t(`explore.mode.${m}`)} tone="success" />
              ))}
            </View>
            {/* Saving needs an account; the save button arrives with sign-in (D12). */}
            {signedIn ? null : <Body muted>{t("branch.saveSignIn")}</Body>}
            <Button
              label={t("branch.hours")}
              variant="secondary"
              onPress={() => setShowHours(!showHours)}
              testID="toggle-hours"
            />
            {showHours ? (
              <View style={styles.card} testID="hours">
                {[1, 2, 3, 4, 5, 6, 7].map((day) => {
                  const intervals = branch.hours.filter((h) => h.weekday === day);
                  return (
                    <Body key={day}>
                      {t(`weekday.${day as 1 | 2 | 3 | 4 | 5 | 6 | 7}`)}:{" "}
                      {intervals.length
                        ? intervals.map((h) => `${h.opens}–${h.closes}`).join(", ")
                        : t("branch.closedDay")}
                    </Body>
                  );
                })}
                {branch.exceptions.map((e) => (
                  <Body key={e.date}>
                    {t("branch.holiday")} {e.date}:{" "}
                    {e.closed
                      ? t("branch.closedDay")
                      : e.intervals.map((i) => `${i.opens}–${i.closes}`).join(", ")}
                  </Body>
                ))}
              </View>
            ) : null}
            {branch.siblings.length > 0 ? (
              <View style={{ gap: 8 }}>
                <Heading level={2}>{t("branch.otherBranches")}</Heading>
                {branch.siblings.map((s) => (
                  <Button
                    key={s.id}
                    label={localized(s.names, locale)}
                    variant="secondary"
                    onPress={() => navigation.replace("Branch", { branchId: s.id })}
                  />
                ))}
              </View>
            ) : null}
            <Heading level={2}>{t("branch.menu")}</Heading>
            {menu.categories.length === 0 ? <Body>{t("branch.emptyMenu")}</Body> : null}
            {menu.categories.map((category) => (
              <View key={category.id} style={{ gap: 8 }}>
                <Heading level={2}>{localized(category.names, locale)}</Heading>
                {category.products.map((product) => {
                  const name = localized(product.names, locale);
                  const price = formatFils(product.priceFils, locale);
                  return (
                    <Pressable
                      key={product.id}
                      testID={`product-${product.id}`}
                      accessibilityRole="button"
                      accessibilityLabel={[
                        name,
                        price,
                        product.available ? null : t("branch.soldOut"),
                      ]
                        .filter(Boolean)
                        .join(", ")}
                      onPress={() =>
                        navigation.navigate("Product", { branchId, productId: product.id })
                      }
                      style={styles.card}
                    >
                      <Text style={styles.body}>{name}</Text>
                      <Text style={styles.muted}>{price}</Text>
                      {product.available ? null : (
                        <StatusChip label={t("branch.soldOut")} tone="error" />
                      )}
                    </Pressable>
                  );
                })}
              </View>
            ))}
          </View>
        )}
      </RemoteState>
      {count > 0 ? (
        <Button
          testID="view-cart"
          label={t("cart.view", { count })}
          onPress={() => navigation.navigate("Cart")}
        />
      ) : null}
    </Screen>
  );
}
