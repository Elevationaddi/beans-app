import type { BottomTabScreenProps } from "@react-navigation/bottom-tabs";
import type { CompositeScreenProps, NavigatorScreenParams } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";

export type TabParams = {
  Home: undefined;
  Explore: { q?: string } | undefined;
  Orders: undefined;
  Profile: undefined;
};

export type RootParams = {
  Onboarding: undefined;
  Tabs: NavigatorScreenParams<TabParams> | undefined;
  Branch: { branchId: string };
  Product: { branchId: string; productId: string };
  Cart: undefined;
  SignIn: undefined;
  Checkout: undefined;
  Order: { orderId: string };
  Receipt: { orderId: string };
  Vehicles: undefined;
  Support: { orderId?: string } | undefined;
  Ticket: { ticketId: string };
  Notifications: undefined;
  Rewards: { sentCode?: string } | undefined;
  Table: { token?: string } | undefined;
};

export type RootScreen<K extends keyof RootParams> = NativeStackScreenProps<RootParams, K>;
export type TabScreen<K extends keyof TabParams> = CompositeScreenProps<
  BottomTabScreenProps<TabParams, K>,
  NativeStackScreenProps<RootParams>
>;
