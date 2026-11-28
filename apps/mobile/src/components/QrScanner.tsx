import { CameraView, useCameraPermissions } from "expo-camera";
import { useRef, useState } from "react";
import { Linking, View } from "react-native";
import { useI18n } from "../i18n";
import { tableTokenFromScan } from "../lib/table";
import { Body, Button, Notice, styles } from "./ui";

/**
 * In-app table QR scanner (cycle 3), using the open-source expo-camera barcode reader on the
 * device: no scanning service. Asks for camera permission only when the customer opens it,
 * reads QR codes only, and hands back the table code from the first valid table QR.
 */
export function QrScanner({
  onToken,
  onClose,
}: {
  onToken: (token: string) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [permission, requestPermission] = useCameraPermissions();
  const handled = useRef(false);
  const lastRejected = useRef<string | null>(null);
  const [notTable, setNotTable] = useState(false);

  if (!permission) return <Body muted>{t("scan.starting")}</Body>;
  if (!permission.granted) {
    return (
      <View style={styles.card} testID="scan-permission">
        <Body>{t("scan.permission")}</Body>
        {permission.canAskAgain ? (
          <Button
            label={t("scan.allow")}
            onPress={() => void requestPermission()}
            testID="scan-allow"
          />
        ) : (
          <Button
            label={t("scan.settings")}
            onPress={() => void Linking.openSettings()}
            testID="scan-settings"
          />
        )}
        <Button label={t("common.cancel")} variant="secondary" onPress={onClose} />
      </View>
    );
  }
  return (
    <View style={{ gap: 12 }} testID="scanner">
      <CameraView
        style={{ width: "100%", aspectRatio: 1, borderRadius: 12, overflow: "hidden" }}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
        accessibilityLabel={t("scan.cameraLabel")}
        onBarcodeScanned={({ data }) => {
          if (handled.current) return;
          const token = tableTokenFromScan(data);
          if (token) {
            handled.current = true;
            onToken(token);
          } else if (lastRejected.current !== data) {
            lastRejected.current = data;
            setNotTable(true);
          }
        }}
        testID="scanner-camera"
      />
      {notTable ? <Notice tone="warning">{t("scan.notTable")}</Notice> : null}
      <Body muted>{t("scan.hint")}</Body>
      <Button
        label={t("common.cancel")}
        variant="secondary"
        onPress={onClose}
        testID="scan-cancel"
      />
    </View>
  );
}
