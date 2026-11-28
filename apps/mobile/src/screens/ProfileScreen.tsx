import { citySchema } from "@beans/contracts";
import { useState } from "react";
import { View } from "react-native";
import {
  Body,
  Button,
  Chip,
  ConfirmDialog,
  FailureText,
  Field,
  Heading,
  Notice,
  Screen,
  styles,
} from "../components/ui";
import { useI18n } from "../i18n";
import { api, call } from "../lib/api";
import { useAction } from "../lib/use-action";
import type { TabScreen } from "../navigation/types";
import { useAppState } from "../state/app-state";

/** C12: language, area and, when signed in, the account: name, vehicles, inbox, privacy. */
export function ProfileScreen({ navigation }: TabScreen<"Profile">) {
  const { t } = useI18n();
  const { prefs, setPrefs, signInAvailable, signedIn, profile, signOut, refreshProfile } =
    useAppState();
  const [name, setName] = useState(profile?.displayName ?? "");
  const [privacy, setPrivacy] = useState<"access" | null>(null);
  const [privacySent, setPrivacySent] = useState<"access" | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const saveName = useAction(async () => {
    await call(api.PATCH("/v1/me", { body: { displayName: name.trim() } }));
    await refreshProfile();
  });
  const requestPrivacy = useAction(async (kind: "access") => {
    await call(api.POST("/v1/me/privacy-requests", { body: { kind } }));
    setPrivacy(null);
    setPrivacySent(kind);
  });
  // Self-service deletion (cycle 3). The server refuses while an order is open.
  const deleteAccount = useAction(async () => {
    await call(api.POST("/v1/me/deletion", { body: { confirm: "DELETE" } }));
    setDeleting(false);
    setConfirmText("");
    await signOut();
  });
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
      {signedIn && profile ? (
        <View style={{ gap: 12 }} testID="account">
          <Body>{profile.email ?? profile.phone ?? ""}</Body>
          <Field
            label={t("profile.name")}
            value={name}
            onChangeText={setName}
            maxLength={80}
            testID="profile-name"
          />
          <Button
            label={t("profile.saveName")}
            variant="secondary"
            onPress={() => void saveName.run()}
            disabled={saveName.pending || !name.trim() || name.trim() === profile.displayName}
          />
          <FailureText failure={saveName.failure} />
          <Button
            label={t("profile.vehicles")}
            variant="secondary"
            onPress={() => navigation.navigate("Vehicles")}
            testID="open-vehicles"
          />
          <Button
            label={t("rewards.title")}
            variant="secondary"
            onPress={() => navigation.navigate("Rewards")}
            testID="open-rewards"
          />
          <Button
            label={t("profile.notifications")}
            variant="secondary"
            onPress={() => navigation.navigate("Notifications")}
            testID="open-notifications"
          />
          <Button
            label={t("profile.support")}
            variant="secondary"
            onPress={() => navigation.navigate("Support", {})}
            testID="open-support"
          />
          <Heading level={2}>{t("profile.privacy")}</Heading>
          <Body muted>{t("profile.privacyHint")}</Body>
          {privacySent ? (
            <Notice tone="success">{t(`profile.privacySent.${privacySent}`)}</Notice>
          ) : null}
          <Button
            label={t("profile.requestData")}
            variant="secondary"
            onPress={() => setPrivacy("access")}
            testID="privacy-access"
          />
          <FailureText failure={requestPrivacy.failure} />
          {deleting ? (
            <View style={styles.card} testID="delete-account-panel">
              <Heading level={2}>{t("profile.requestDeletion")}</Heading>
              <Body>{t("profile.deletionBody")}</Body>
              <Field
                label={t("profile.deletionConfirm")}
                value={confirmText}
                onChangeText={setConfirmText}
                autoCapitalize="characters"
                testID="delete-account-confirm-text"
              />
              <Button
                label={t("profile.deletionSubmit")}
                variant="destructive"
                onPress={() => void deleteAccount.run()}
                disabled={deleteAccount.pending || confirmText.trim() !== "DELETE"}
                testID="delete-account-submit"
              />
              <FailureText failure={deleteAccount.failure} />
              <Button
                label={t("common.cancel")}
                variant="secondary"
                onPress={() => {
                  setDeleting(false);
                  setConfirmText("");
                }}
              />
            </View>
          ) : (
            <Button
              label={t("profile.requestDeletion")}
              variant="destructive"
              onPress={() => setDeleting(true)}
              testID="privacy-deletion"
            />
          )}
          <Button
            label={t("auth.signOut")}
            variant="secondary"
            onPress={() => void signOut()}
            testID="sign-out"
          />
        </View>
      ) : (
        <View style={{ gap: 12 }}>
          <Body>{t("profile.guest")}</Body>
          {signInAvailable ? (
            <Button
              label={t("auth.signIn")}
              onPress={() => navigation.navigate("SignIn")}
              testID="profile-sign-in"
            />
          ) : (
            <Body muted>{t("profile.signInUnavailable")}</Body>
          )}
        </View>
      )}
      <ConfirmDialog
        visible={privacy !== null}
        title={t("profile.requestData")}
        body={t("profile.accessBody")}
        confirmLabel={t("common.continue")}
        onConfirm={() => privacy && void requestPrivacy.run(privacy)}
        onCancel={() => setPrivacy(null)}
      />
    </Screen>
  );
}
