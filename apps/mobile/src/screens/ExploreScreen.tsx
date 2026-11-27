import { fulfilmentModeSchema } from "@beans/contracts";
import { useState } from "react";
import { TextInput, View } from "react-native";
import { colors, radius, space, touchTarget } from "@beans/ui";
import { BranchCard } from "../components/branch-card";
import { Body, Button, Chip, RemoteState, Screen, styles } from "../components/ui";
import { useI18n } from "../i18n";
import { api, call } from "../lib/api";
import { useRemote } from "../lib/use-remote";
import type { TabScreen } from "../navigation/types";
import { useAppState } from "../state/app-state";

type Mode = "in_store" | "curbside" | "dine_in";

/** C03: search active branches by name, pickup type and open now; list view. */
export function ExploreScreen({ navigation, route }: TabScreen<"Explore">) {
  const { t } = useI18n();
  const { prefs, coords } = useAppState();
  const [q, setQ] = useState(route.params?.q ?? "");
  const [openNow, setOpenNow] = useState(false);
  const [mode, setMode] = useState<Mode | null>(null);

  const query = q.trim();
  const remote = useRemote(
    () =>
      call(
        api.GET("/v1/branches", {
          params: {
            query: {
              city: prefs.city,
              limit: 50,
              ...(query && { q: query }),
              ...(openNow && { openNow: "true" as const }),
              ...(mode && { mode }),
              ...(coords && { lat: coords.lat, lng: coords.lng }),
            },
          },
        }),
      ),
    [prefs.city, query, openNow, mode, coords?.lat, coords?.lng],
  );

  const reset = () => {
    setQ("");
    setOpenNow(false);
    setMode(null);
  };

  return (
    <Screen testID="explore">
      <TextInput
        testID="explore-search"
        accessibilityLabel={t("explore.search")}
        placeholder={t("explore.search")}
        value={q}
        onChangeText={setQ}
        style={{
          minHeight: touchTarget.android,
          borderWidth: 1,
          borderColor: colors.border,
          borderRadius: radius.md,
          paddingHorizontal: space[3],
          backgroundColor: colors.surface,
          color: colors.ink,
          textAlign: "auto",
        }}
      />
      <View style={styles.row}>
        <Chip
          testID="filter-open-now"
          role="switch"
          label={t("explore.openNow")}
          selected={openNow}
          onPress={() => setOpenNow(!openNow)}
        />
        {fulfilmentModeSchema.options
          .filter((m) => m !== "dine_in")
          .map((m) => (
            <Chip
              key={m}
              testID={`filter-mode-${m}`}
              role="radio"
              label={t(`explore.mode.${m}`)}
              selected={mode === m}
              onPress={() => setMode(mode === m ? null : m)}
            />
          ))}
      </View>
      <RemoteState
        remote={remote}
        isEmpty={(page) => page.data.length === 0}
        empty={
          <View style={{ gap: 12 }}>
            <Body>{t("explore.empty")}</Body>
            <Button
              testID="reset-filters"
              label={t("explore.reset")}
              variant="secondary"
              onPress={reset}
            />
          </View>
        }
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
