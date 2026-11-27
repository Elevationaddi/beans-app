/* eslint-disable @typescript-eslint/no-require-imports */
jest.mock("@react-native-async-storage/async-storage", () =>
  require("@react-native-async-storage/async-storage/jest/async-storage-mock"),
);

jest.mock("expo-location", () => ({
  Accuracy: { Balanced: 3 },
  requestForegroundPermissionsAsync: jest.fn(async () => ({ status: "denied" })),
  getCurrentPositionAsync: jest.fn(),
}));

// Safe-area insets come from native code; the library ships a mock for tests.
jest.mock(
  "react-native-safe-area-context",
  () => require("react-native-safe-area-context/jest/mock").default,
);
