import { NavigationContainer } from "@react-navigation/native";
import type { ReactNode } from "react";
import { ActivityIndicator, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { colors } from "@beans/ui";
import { I18nProvider } from "./i18n";
import { RootNavigator } from "./navigation/RootNavigator";
import { useAppState } from "./state/app-state";

/** Applies language and layout direction (RTL for Arabic) above the navigator. */
export function LocalizedApp({ children }: { children?: ReactNode }) {
  const { ready, prefs } = useAppState();
  if (!ready) {
    return (
      <View style={{ flex: 1, justifyContent: "center", backgroundColor: colors.background }}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }
  return (
    <I18nProvider locale={prefs.locale}>
      <View testID="app-root" style={{ flex: 1, direction: prefs.locale === "ar" ? "rtl" : "ltr" }}>
        <SafeAreaProvider>
          <NavigationContainer direction={prefs.locale === "ar" ? "rtl" : "ltr"}>
            {children ?? <RootNavigator />}
          </NavigationContainer>
        </SafeAreaProvider>
      </View>
    </I18nProvider>
  );
}
