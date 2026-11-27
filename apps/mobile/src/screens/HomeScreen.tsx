import { View } from "react-native";
import { BranchCard } from "../components/branch-card";
import { Body, Button, Heading, RemoteState, Screen } from "../components/ui";
import { useI18n } from "../i18n";
import { api, call } from "../lib/api";
import { useRemote } from "../lib/use-remote";
import type { TabScreen } from "../navigation/types";
import { useAppState } from "../state/app-state";

/** C02: current area, saved cafés (signed in), cafés nearby or in the chosen emirate. */
export function HomeScreen({ navigation }: TabScreen<"Home">) {
  const { t } = useI18n();
  const { prefs, coords, signedIn } = useAppState();
  const cityName = t(`city.${prefs.city}`);
  const remote = useRemote(
    () =>
      call(
        api.GET("/v1/branches", {
          params: {
            query: {
              city: prefs.city,
              limit: 10,
              ...(coords && { lat: coords.lat, lng: coords.lng }),
            },
          },
        }),
      ),
    [prefs.city, coords?.lat, coords?.lng],
  );

  return (
    <Screen testID="home">
      <Heading>{t("home.area", { city: cityName })}</Heading>
      <Button
        label={t("home.changeArea")}
        variant="secondary"
        onPress={() => navigation.navigate("Profile")}
      />
      <Button
        label={t("home.search")}
        variant="secondary"
        onPress={() => navigation.navigate("Explore")}
      />
      <Heading level={2}>{t("home.favorites")}</Heading>
      {signedIn ? null : <Body muted>{t("home.favoritesSignIn")}</Body>}
      <RemoteState
        remote={remote}
        isEmpty={(page) => page.data.length === 0}
        empty={<Body>{t("home.empty", { city: cityName })}</Body>}
      >
        {(page) => (
          <View style={{ gap: 12 }}>
            {page.data.map((branch) => (
              <BranchCard
                key={branch.id}
                branch={branch}
                onPress={() => navigation.navigate("Branch", { branchId: branch.id })}
              />
            ))}
          </View>
        )}
      </RemoteState>
    </Screen>
  );
}
