import { Body, Heading, Screen } from "../components/ui";
import { useI18n } from "../i18n";

/** C08/C09 arrive with ordering (phases 6–8). Guests have no orders. */
export function OrdersScreen() {
  const { t } = useI18n();
  return (
    <Screen testID="orders">
      <Heading>{t("tabs.orders")}</Heading>
      <Body>{t("orders.signIn")}</Body>
    </Screen>
  );
}
