import * as SecureStore from "expo-secure-store";

/**
 * Device keychain for the Supabase refresh token. On platforms without a keychain (the web
 * preview) nothing is stored and the person signs in again next time.
 */
const KEY = "auth.refresh.v1";

export async function loadRefreshToken(): Promise<string | null> {
  try {
    if (!(await SecureStore.isAvailableAsync())) return null;
    return await SecureStore.getItemAsync(KEY);
  } catch {
    return null;
  }
}

export async function saveRefreshToken(token: string | null): Promise<void> {
  try {
    if (!(await SecureStore.isAvailableAsync())) return;
    if (token) await SecureStore.setItemAsync(KEY, token);
    else await SecureStore.deleteItemAsync(KEY);
  } catch {
    // Keychain unavailable: the session lasts until the app closes.
  }
}
