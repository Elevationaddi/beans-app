import type { ResolvedTable } from "@beans/contracts";
import { useEffect, useState } from "react";
import { View } from "react-native";
import {
  Body,
  Button,
  FailureText,
  Field,
  Heading,
  Notice,
  Screen,
  styles,
} from "../components/ui";
import { QrScanner } from "../components/QrScanner";
import { localized, useI18n } from "../i18n";
import { api, call } from "../lib/api";
import { setTable, useTable } from "../lib/table";
import { useAction } from "../lib/use-action";
import type { RootScreen } from "../navigation/types";

type Resolved = ResolvedTable;

/**
 * Dine-in: the customer opens the link in a table's QR code (or types the code under it). The
 * server checks the signed code and says which café and table it is; orders then go to that
 * table. The in-app scanner reads the same QR (only its code is used, never the link).
 */
export function TableScreen({ navigation, route }: RootScreen<"Table">) {
  const { t, locale } = useI18n();
  const chosen = useTable();
  const [code, setCode] = useState(route.params?.token ?? "");
  const [resolved, setResolved] = useState<Resolved | null>(null);
  const [scanning, setScanning] = useState(false);
  const check = useAction(async (token: string) => {
    const result = await call(
      api.GET("/v1/tables/resolve", { params: { query: { token: token.trim() } } }),
    );
    setResolved(result.data);
  });
  const linked = route.params?.token;
  useEffect(() => {
    // Opened from a QR link: check the code straight away.
    if (linked) void check.run(linked);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linked]);

  return (
    <Screen testID="table">
      <Heading>{t("table.title")}</Heading>
      <Body muted>{t("table.intro")}</Body>
      {chosen && !resolved ? (
        <Notice tone="info" testID="table-current">
          {t("table.current", { label: chosen.label })}
        </Notice>
      ) : null}
      {resolved ? (
        <View style={styles.card} testID="table-found">
          <Heading level={2}>{t("table.found", { label: resolved.table.label })}</Heading>
          <Body>{`${resolved.brandName} · ${localized(resolved.branchNames, locale)}`}</Body>
          <Button
            label={t("table.orderHere")}
            onPress={() => {
              setTable({
                token: code.trim(),
                branchId: resolved.branchId,
                label: resolved.table.label,
              });
              navigation.replace("Branch", { branchId: resolved.branchId });
            }}
            testID="table-order"
          />
        </View>
      ) : scanning ? (
        <QrScanner
          onToken={(token) => {
            setScanning(false);
            setCode(token);
            void check.run(token);
          }}
          onClose={() => setScanning(false)}
        />
      ) : (
        <View style={{ gap: 12 }}>
          <Button label={t("scan.open")} onPress={() => setScanning(true)} testID="table-scan" />
          <Field
            label={t("table.code")}
            hint={t("table.codeHint")}
            value={code}
            onChangeText={setCode}
            autoCapitalize="none"
            autoCorrect={false}
            testID="table-code"
          />
          <Button
            label={t("table.check")}
            onPress={() => void check.run(code)}
            disabled={check.pending || code.trim().length < 10}
            testID="table-check"
          />
        </View>
      )}
      <FailureText failure={check.failure} />
      {chosen ? (
        <Button
          label={t("table.leave")}
          variant="secondary"
          onPress={() => {
            setTable(null);
            setResolved(null);
          }}
          testID="table-leave"
        />
      ) : null}
    </Screen>
  );
}
