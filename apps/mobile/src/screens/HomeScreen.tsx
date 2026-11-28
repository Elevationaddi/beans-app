import { useEffect } from "react";
import { View } from "react-native";
import { BranchCard } from "../components/branch-card";
import { Body, Button, Heading, Notice, RemoteState, Screen } from "../components/ui";
import { localized, useI18n } from "../i18n";
import { api, call } from "../lib/api";
import { usePlatformStatus } from "../lib/platform";
import { useRemote } from "../lib/use-remote";
import type { TabScreen } from "../navigation/types";
import { tableTokenFromLink, useTable } from "../lib/table";
import { useAppState } from "../state/app-state";

/**
 * C02: ordering pause notice, the homepage hero and featured shops chosen in the admin console,
 * saved cafés (signed in), and cafés nearby or in the chosen emirate.
 */
export function HomeScreen({ navigation }: TabScreen<"Home">) {
  const { t, locale } = useI18n();
  const { prefs, coords, signedIn } = useAppState();
  const cityName = t(`city.${prefs.city}`);
  const status = usePlatformStatus();
  const homepage = useRemote(async () => (await call(api.GET("/v1/platform/homepage"))).data, []);
  const favorites = useRemote(
    async () =>
      signedIn
        ? (await call(api.GET("/v1/favorites", { params: { query: { limit: 20 } } }))).data
        : [],
    [signedIn],
  );
  const openShop = (brandName: string) => navigation.navigate("Explore", { q: brandName });
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

  // A table QR code opened in the browser: go straight to that table.
  useEffect(() => {
    const token = tableTokenFromLink();
    if (token) navigation.navigate("Table", { token });
  }, [navigation]);
  const table = useTable();

  return (
    <Screen testID="home">
      {table ? (
        <Notice tone="info" testID="home-table">
          {t("table.current", { label: table.label })}
        </Notice>
      ) : null}
      {status.data?.ordersPaused ? (
        <Notice tone="warning" testID="paused">
          {status.data.message ? localized(status.data.message, locale) : t("platform.paused")}
        </Notice>
      ) : null}
      {homepage.data?.hero ? (
        <Heading testID="hero">{localized(homepage.data.hero, locale)}</Heading>
      ) : null}
      <Heading>{t("home.area", { city: cityName })}</Heading>
      <Button
        label={t("home.changeArea")}
        variant="secondary"
        onPress={() => navigation.navigate("Profile")}
      />
      <Button
        label={t("table.open")}
        variant="secondary"
        onPress={() => navigation.navigate("Table")}
        testID="open-table"
      />
      <Button
        label={t("home.search")}
        variant="secondary"
        onPress={() => navigation.navigate("Explore")}
      />
      {homepage.data && homepage.data.featured.length > 0 ? (
        <View style={{ gap: 8 }} testID="featured">
          <Heading level={2}>{t("home.featured")}</Heading>
          {homepage.data.featured.map((shop) => (
            <Button
              key={shop.merchantId}
              label={shop.brandName}
              variant="secondary"
              onPress={() => openShop(shop.brandName)}
            />
          ))}
        </View>
      ) : null}
      <Heading level={2}>{t("home.favorites")}</Heading>
      {signedIn ? (
        <RemoteState
          remote={favorites}
          isEmpty={(list) => list.length === 0}
          empty={<Body muted>{t("home.favoritesNone")}</Body>}
        >
          {(list) => (
            <View style={{ gap: 8 }} testID="favorites">
              {list.map((fav) => (
                <Button
                  key={fav.merchantId}
                  label={fav.brandName}
                  variant="secondary"
                  onPress={() => openShop(fav.brandName)}
                />
              ))}
            </View>
          )}
        </RemoteState>
      ) : (
        <Body muted>{t("home.favoritesSignIn")}</Body>
      )}
      <Heading level={2}>{t("home.nearby")}</Heading>
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
