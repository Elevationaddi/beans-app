import type { City, DevAccount, Profile } from "@beans/contracts";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { Locale } from "../i18n";
import { api, call } from "../lib/api";
import { config } from "../lib/config";
import { setAccessToken, setUnauthorizedHandler } from "../lib/session";
import {
  type OtpTarget,
  refresh,
  sendOtp,
  signInWithPassword,
  supabaseConfigured,
  verifyOtp,
} from "../lib/supabase-auth";
import { loadRefreshToken, saveRefreshToken } from "./secure";
import { type AddRequest, addLine, type Cart, emptyCart, removeLine, replaceWith } from "./cart";
import { loadJson, saveJson } from "./storage";

export interface Prefs {
  onboarded: boolean;
  locale: Locale;
  city: City;
}

export interface Coords {
  lat: number;
  lng: number;
}

const PREFS_KEY = "prefs.v1";
const CART_KEY = "cart.v1";

/** D01 proposed pilot: Abu Dhabi. The customer can pick any emirate. */
export const defaultPrefs: Prefs = { onboarded: false, locale: "en", city: "abu_dhabi" };

interface AppState {
  ready: boolean;
  prefs: Prefs;
  setPrefs: (patch: Partial<Prefs>) => void;
  /** Kept in memory only, and only after the customer allowed location. */
  coords: Coords | null;
  setCoords: (coords: Coords | null) => void;
  /** Signed in with a profile loaded from the API (roles always come from the server). */
  signedIn: boolean;
  profile: Profile | null;
  /** Some way to sign in exists in this build: Supabase codes or development sign-in. */
  signInAvailable: boolean;
  /** True when the last session ended because it expired. */
  sessionExpired: boolean;
  devAccounts: () => Promise<DevAccount[]>;
  signInDev: (userId: string) => Promise<void>;
  sendCode: (target: OtpTarget) => Promise<void>;
  verifyCode: (target: OtpTarget, code: string) => Promise<void>;
  signInDemo: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  cart: Cart;
  /** Returns the name of the other branch when the customer must confirm replacing the cart. */
  addToCart: (request: AddRequest) => string | null;
  replaceCart: (request: AddRequest) => void;
  removeFromCart: (key: string) => void;
  clearCart: () => void;
}

const Ctx = createContext<AppState | null>(null);

/** For tests: start signed in with this token and profile. */
export interface InitialSession {
  accessToken: string;
  profile: Profile;
}

export function AppStateProvider({
  children,
  initialPrefs,
  initialCart,
  initialSession,
}: {
  children: ReactNode;
  initialPrefs?: Prefs;
  initialCart?: Cart;
  initialSession?: InitialSession;
}) {
  const [ready, setReady] = useState(initialPrefs !== undefined);
  const [prefs, setPrefsState] = useState<Prefs>(initialPrefs ?? defaultPrefs);
  const [cart, setCart] = useState<Cart>(initialCart ?? emptyCart);
  const [coords, setCoords] = useState<Coords | null>(null);
  const [profile, setProfile] = useState<Profile | null>(() => {
    if (initialSession) setAccessToken(initialSession.accessToken);
    return initialSession?.profile ?? null;
  });
  const [sessionExpired, setSessionExpired] = useState(false);

  const loadProfile = useCallback(async () => {
    const me = await call(api.GET("/v1/me"));
    setProfile(me.data);
  }, []);

  const endSession = useCallback(async (expired: boolean) => {
    setAccessToken(null);
    setProfile(null);
    setSessionExpired(expired);
    await saveRefreshToken(null);
  }, []);

  // A 401 on a signed-in request means the session expired or was revoked.
  useEffect(() => {
    setUnauthorizedHandler(() => void endSession(true));
    return () => setUnauthorizedHandler(null);
  }, [endSession]);

  // Restore a Supabase session from the keychain on start.
  useEffect(() => {
    if (initialSession || !supabaseConfigured) return;
    void (async () => {
      const saved = await loadRefreshToken();
      if (!saved) return;
      try {
        const session = await refresh(saved);
        setAccessToken(session.accessToken);
        await saveRefreshToken(session.refreshToken);
        await loadProfile();
      } catch {
        await endSession(false);
      }
    })();
  }, [initialSession, loadProfile, endSession]);

  useEffect(() => {
    if (initialPrefs !== undefined) return;
    void (async () => {
      const [savedPrefs, savedCart] = await Promise.all([
        loadJson<Prefs>(PREFS_KEY),
        loadJson<Cart>(CART_KEY),
      ]);
      if (savedPrefs) setPrefsState({ ...defaultPrefs, ...savedPrefs });
      if (savedCart) setCart(savedCart);
      setReady(true);
    })();
  }, [initialPrefs]);

  const setPrefs = useCallback((patch: Partial<Prefs>) => {
    setPrefsState((current) => {
      const next = { ...current, ...patch };
      void saveJson(PREFS_KEY, next);
      return next;
    });
  }, []);

  const commitCart = useCallback((next: Cart) => {
    setCart(next);
    void saveJson(CART_KEY, next);
  }, []);

  const value = useMemo<AppState>(
    () => ({
      ready,
      prefs,
      setPrefs,
      coords,
      setCoords,
      signedIn: profile !== null,
      profile,
      signInAvailable: supabaseConfigured || config.devAuth,
      sessionExpired,
      devAccounts: async () => (await call(api.GET("/v1/dev-auth/accounts"))).data,
      signInDev: async (userId) => {
        const session = await call(
          api.POST("/v1/dev-auth/sessions", { body: { userId, mfa: false } }),
        );
        // Development sessions stay in memory only.
        setAccessToken(session.data.accessToken);
        setSessionExpired(false);
        await loadProfile();
      },
      sendCode: (target) => sendOtp(target),
      verifyCode: async (target, code) => {
        const session = await verifyOtp(target, code);
        setAccessToken(session.accessToken);
        await saveRefreshToken(session.refreshToken);
        setSessionExpired(false);
        await loadProfile();
      },
      signInDemo: async (email, password) => {
        const session = await signInWithPassword(email, password);
        setAccessToken(session.accessToken);
        await saveRefreshToken(session.refreshToken);
        setSessionExpired(false);
        await loadProfile();
      },
      signOut: () => endSession(false),
      refreshProfile: loadProfile,
      cart,
      addToCart: (request) => {
        const outcome = addLine(cart, request);
        if (outcome.kind === "needs_confirmation") return outcome.currentBranch;
        commitCart(outcome.cart);
        return null;
      },
      replaceCart: (request) => commitCart(replaceWith(request)),
      removeFromCart: (key) => commitCart(removeLine(cart, key)),
      clearCart: () => commitCart(emptyCart),
    }),
    [
      ready,
      prefs,
      setPrefs,
      coords,
      cart,
      commitCart,
      profile,
      sessionExpired,
      loadProfile,
      endSession,
    ],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAppState(): AppState {
  const value = useContext(Ctx);
  if (!value) throw new Error("useAppState outside AppStateProvider");
  return value;
}
