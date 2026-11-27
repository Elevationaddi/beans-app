import { citySchema } from "@beans/contracts";
import { View } from "react-native";
import { Body, Chip, Heading, Screen, styles } from "../components/ui";
import { useI18n } from "../i18n";
import { useAppState } from "../state/app-state";

/** C12 (guest part): language and area. Account features arrive with sign-in (D12). */
export function ProfileScreen() {
  const { t } = useI18n();
  const { prefs, setPrefs, signInAvailable } = useAppState();
  return (
    <Screen testID="profile">
      <Heading>{t("profile.title")}</Heading>
      <Heading level={2}>{t("profile.language")}</Heading>
      <View style={styles.row} accessibilityRole="radiogroup">
        <Chip
          role="radio"
          label="English"
          selected={prefs.locale === "en"}
          onPress={() => setPrefs({ locale: "en" })}
          testID="lang-en"
        />
        <Chip
          role="radio"
          label="العربية"
          selected={prefs.locale === "ar"}
          onPress={() => setPrefs({ locale: "ar" })}
          testID="lang-ar"
        />
      </View>
      <Heading level={2}>{t("profile.area")}</Heading>
      <View style={styles.row} accessibilityRole="radiogroup">
        {citySchema.options.map((city) => (
          <Chip
            key={city}
            role="radio"
            label={t(`city.${city}`)}
            selected={prefs.city === city}
            onPress={() => setPrefs({ city })}
          />
        ))}
      </View>
      <Heading level={2}>{t("profile.account")}</Heading>
      <Body>{t("profile.guest")}</Body>
      {signInAvailable ? null : <Body muted>{t("profile.signInUnavailable")}</Body>}
    </Screen>
  );
}
