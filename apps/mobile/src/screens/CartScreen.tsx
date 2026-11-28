import { View } from "react-native";
import { Body, Button, Heading, Screen, styles } from "../components/ui";
import { useI18n } from "../i18n";
import { formatFils, sumFils } from "../lib/money";
import type { RootScreen } from "../navigation/types";
import { useAppState } from "../state/app-state";

/**
 * C06: one branch's items with server line prices. Checkout needs an account: guests are
 * offered sign-in first. Totals here are estimates; the server quote at checkout is final.
 */
export function CartScreen({ navigation }: RootScreen<"Cart">) {
  const { t, locale } = useI18n();
  const { cart, removeFromCart, signedIn } = useAppState();

  if (cart.lines.length === 0) {
    return (
      <Screen testID="cart">
        <Heading>{t("cart.title")}</Heading>
        <Body>{t("cart.empty")}</Body>
      </Screen>
    );
  }
  const subtotal = sumFils(cart.lines.map((l) => l.lineFils));
  return (
    <Screen testID="cart">
      <Heading>{t("cart.title")}</Heading>
      <Body muted>{t("cart.from", { branch: cart.branchName ?? "" })}</Body>
      {cart.lines.map((line) => (
        <View key={line.key} style={styles.card}>
          <Body>{`${line.quantity} × ${line.name}`}</Body>
          {line.optionNames.length > 0 ? <Body muted>{line.optionNames.join(", ")}</Body> : null}
          <Body>{formatFils(line.lineFils, locale)}</Body>
          <Button
            label={t("cart.remove", { name: line.name })}
            variant="secondary"
            onPress={() => removeFromCart(line.key)}
          />
        </View>
      ))}
      <Heading level={2}>{`${t("cart.subtotal")}: ${formatFils(subtotal, locale)}`}</Heading>
      <Body muted>{t("cart.estimate")}</Body>
      {signedIn ? (
        <Button
          label={t("cart.checkout")}
          onPress={() => navigation.navigate("Checkout")}
          testID="checkout"
        />
      ) : (
        <>
          <Body>{t("cart.signInToCheckout")}</Body>
          <Button
            label={t("auth.signIn")}
            onPress={() => navigation.navigate("SignIn")}
            testID="checkout-sign-in"
          />
        </>
      )}
    </Screen>
  );
}
