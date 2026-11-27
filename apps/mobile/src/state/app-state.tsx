import type { City } from "@beans/contracts";
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
import { config } from "../lib/config";
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
  /** Guests only until sign-in is configured (D12). */
  signedIn: boolean;
  signInAvailable: boolean;
  cart: Cart;
  /** Returns the name of the other branch when the customer must confirm replacing the cart. */
  addToCart: (request: AddRequest) => string | null;
  replaceCart: (request: AddRequest) => void;
  removeFromCart: (key: string) => void;
}

const Ctx = createContext<AppState | null>(null);

export function AppStateProvider({
  children,
  initialPrefs,
  initialCart,
}: {
  children: ReactNode;
  initialPrefs?: Prefs;
  initialCart?: Cart;
}) {
  const [ready, setReady] = useState(initialPrefs !== undefined);
  const [prefs, setPrefsState] = useState<Prefs>(initialPrefs ?? defaultPrefs);
  const [cart, setCart] = useState<Cart>(initialCart ?? emptyCart);
  const [coords, setCoords] = useState<Coords | null>(null);

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
      signedIn: false,
      signInAvailable: config.supabaseUrl !== null,
      cart,
      addToCart: (request) => {
        const outcome = addLine(cart, request);
        if (outcome.kind === "needs_confirmation") return outcome.currentBranch;
        commitCart(outcome.cart);
        return null;
      },
      replaceCart: (request) => commitCart(replaceWith(request)),
      removeFromCart: (key) => commitCart(removeLine(cart, key)),
    }),
    [ready, prefs, setPrefs, coords, cart, commitCart],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAppState(): AppState {
  const value = useContext(Ctx);
  if (!value) throw new Error("useAppState outside AppStateProvider");
  return value;
}
