import { StatusBar } from "expo-status-bar";
import { LocalizedApp } from "./src/AppRoot";
import { AppStateProvider } from "./src/state/app-state";

export default function App() {
  return (
    <AppStateProvider>
      <LocalizedApp />
      <StatusBar style="dark" />
    </AppStateProvider>
  );
}
