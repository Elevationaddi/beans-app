import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { colors } from "@beans/ui";
import { useI18n } from "../i18n";
import { BranchScreen } from "../screens/BranchScreen";
import { CartScreen } from "../screens/CartScreen";
import { ExploreScreen } from "../screens/ExploreScreen";
import { HomeScreen } from "../screens/HomeScreen";
import { OnboardingScreen } from "../screens/OnboardingScreen";
import { OrdersScreen } from "../screens/OrdersScreen";
import { ProductScreen } from "../screens/ProductScreen";
import { ProfileScreen } from "../screens/ProfileScreen";
import { useAppState } from "../state/app-state";
import type { RootParams, TabParams } from "./types";

const Stack = createNativeStackNavigator<RootParams>();
const Tabs = createBottomTabNavigator<TabParams>();

function TabsNavigator() {
  const { t } = useI18n();
  return (
    <Tabs.Navigator
      screenOptions={{ tabBarActiveTintColor: colors.primary, headerTitleAlign: "center" }}
    >
      <Tabs.Screen
        name="Home"
        component={HomeScreen}
        options={{ title: t("tabs.home"), tabBarAccessibilityLabel: t("tabs.home") }}
      />
      <Tabs.Screen
        name="Explore"
        component={ExploreScreen}
        options={{ title: t("tabs.explore"), tabBarAccessibilityLabel: t("tabs.explore") }}
      />
      <Tabs.Screen
        name="Orders"
        component={OrdersScreen}
        options={{ title: t("tabs.orders"), tabBarAccessibilityLabel: t("tabs.orders") }}
      />
      <Tabs.Screen
        name="Profile"
        component={ProfileScreen}
        options={{ title: t("tabs.profile"), tabBarAccessibilityLabel: t("tabs.profile") }}
      />
    </Tabs.Navigator>
  );
}

export function RootNavigator() {
  const { t } = useI18n();
  const { prefs } = useAppState();
  return (
    <Stack.Navigator>
      {prefs.onboarded ? (
        <>
          <Stack.Screen name="Tabs" component={TabsNavigator} options={{ headerShown: false }} />
          <Stack.Screen name="Branch" component={BranchScreen} options={{ title: "" }} />
          <Stack.Screen name="Product" component={ProductScreen} options={{ title: "" }} />
          <Stack.Screen name="Cart" component={CartScreen} options={{ title: t("cart.title") }} />
        </>
      ) : (
        <Stack.Screen
          name="Onboarding"
          component={OnboardingScreen}
          options={{ title: t("appName") }}
        />
      )}
    </Stack.Navigator>
  );
}
