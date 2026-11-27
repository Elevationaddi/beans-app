import { citySchema, type City } from "@beans/contracts";
import * as Location from "expo-location";
import { useState } from "react";
import { View } from "react-native";
import { Body, Button, Chip, Heading, Screen, styles } from "../components/ui";
import { useI18n } from "../i18n";
import { useAppState } from "../state/app-state";

/** C01 guest path: language, emirate, optional location, then browse without an account. */
export function OnboardingScreen() {
  const { t } = useI18n();
  const { prefs, setPrefs, coords, setCoords } = useAppState();
  const [locationNote, setLocationNote] = useState<string | null>(null);

  async function askLocation() {
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== "granted") {
        setCoords(null);
        setLocationNote(t("onboarding.locationDenied"));
        return;
      }
      const position = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      setCoords({ lat: position.coords.latitude, lng: position.coords.longitude });
      setLocationNote(t("onboarding.locationOn"));
    } catch {
      setCoords(null);
      setLocationNote(t("onboarding.locationDenied"));
    }
  }

  return (
    <Screen testID="onboarding">
      <Heading>{t("onboarding.title")}</Heading>
      <Heading level={2}>{t("onboarding.language")}</Heading>
      <View style={styles.row} accessibilityRole="radiogroup">
        <Chip
          role="radio"
          label="English"
          selected={prefs.locale === "en"}
          onPress={() => setPrefs({ locale: "en" })}
        />
        <Chip
          role="radio"
          label="العربية"
          selected={prefs.locale === "ar"}
          onPress={() => setPrefs({ locale: "ar" })}
        />
      </View>
      <Heading level={2}>{t("onboarding.city")}</Heading>
      <View style={styles.row} accessibilityRole="radiogroup">
        {citySchema.options.map((city: City) => (
          <Chip
            key={city}
            testID={`city-${city}`}
            role="radio"
            label={t(`city.${city}`)}
            selected={prefs.city === city}
            onPress={() => setPrefs({ city })}
          />
        ))}
      </View>
      <Button
        testID="use-location"
        label={t("onboarding.useLocation")}
        hint={t("onboarding.locationHint")}
        variant="secondary"
        onPress={() => void askLocation()}
      />
      <Body muted>
        {locationNote ?? (coords ? t("onboarding.locationOn") : t("onboarding.locationHint"))}
      </Body>
      <Button
        testID="continue-guest"
        label={t("onboarding.guest")}
        onPress={() => setPrefs({ onboarded: true })}
      />
    </Screen>
  );
}
