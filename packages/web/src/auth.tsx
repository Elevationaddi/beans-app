"use client";
import {
  devAccountListResponseSchema,
  devSessionResponseSchema,
  profileResponseSchema,
  type DevAccount,
  type Profile,
} from "@beans/contracts";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ApiClient, ApiError } from "./api";

export interface Session {
  accessToken: string;
  expiresAt: string;
  aal: "aal1" | "aal2";
  source: "dev" | "supabase";
}

export interface AuthConfig {
  apiUrl: string;
  /** Public Supabase settings. When absent, only development sign-in is offered. */
  supabaseUrl?: string | undefined;
  supabaseAnonKey?: string | undefined;
  /** Offer development sign-in (fictional accounts). Never set in production builds. */
  devAuth: boolean;
  /** Storage key, one per surface, so the portal and the tablet keep separate sessions. */
  storageKey: string;
}

type Status = "loading" | "signed_out" | "signed_in" | "expired";

interface AuthValue {
  status: Status;
  session: Session | null;
  profile: Profile | null;
  api: ApiClient;
  config: AuthConfig;
  supabaseReady: boolean;
  /** Public Supabase client (anon key), also used for live order signals. Null when unset. */
  supabase: SupabaseClient | null;
  devAccounts: () => Promise<DevAccount[]>;
  signInDev: (userId: string, mfa: boolean) => Promise<void>;
  signInPassword: (email: string, password: string) => Promise<void>;
  signUpPassword: (email: string, password: string, redirectTo: string) => Promise<void>;
  sendPasswordReset: (email: string, redirectTo: string) => Promise<void>;
  updatePassword: (password: string) => Promise<void>;
  mfaEnroll: () => Promise<{ factorId: string; qrCode: string; secret: string }>;
  mfaFactors: () => Promise<{ id: string; status: string }[]>;
  mfaVerify: (factorId: string, code: string) => Promise<void>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

export class AuthUnavailableError extends Error {
  constructor() {
    super("Sign-in with a password needs a configured Supabase project.");
  }
}

function load(key: string): Session | null {
  try {
    const raw = window.sessionStorage.getItem(key);
    if (!raw) return null;
    const value = JSON.parse(raw) as Session;
    return new Date(value.expiresAt).getTime() > Date.now() ? value : null;
  } catch {
    return null;
  }
}

function store(key: string, session: Session | null) {
  try {
    if (session) window.sessionStorage.setItem(key, JSON.stringify(session));
    else window.sessionStorage.removeItem(key);
  } catch {
    // Storage blocked: the session lasts until the page is reloaded.
  }
}

/**
 * Sign-in for the web surfaces (D12). Supabase Auth in real environments; development sign-in
 * for fictional accounts locally. Roles always come from the API (`/v1/me`), never the token.
 */
export function AuthProvider({ config, children }: { config: AuthConfig; children: ReactNode }) {
  const [status, setStatus] = useState<Status>("loading");
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const sessionRef = useRef<Session | null>(null);
  const supabase = useMemo<SupabaseClient | null>(
    () =>
      config.supabaseUrl && config.supabaseAnonKey
        ? createClient(config.supabaseUrl, config.supabaseAnonKey, {
            auth: { persistSession: true, storageKey: `${config.storageKey}.sb` },
          })
        : null,
    [config.supabaseUrl, config.supabaseAnonKey, config.storageKey],
  );

  const expire = useCallback(() => {
    sessionRef.current = null;
    store(config.storageKey, null);
    setSession(null);
    setProfile(null);
    setStatus("expired");
  }, [config.storageKey]);

  const api = useMemo(
    () =>
      new ApiClient({
        baseUrl: config.apiUrl,
        token: () => sessionRef.current?.accessToken ?? null,
        onUnauthorized: expire,
        locale: () => document.documentElement.lang || "en",
      }),
    [config.apiUrl, expire],
  );

  const adopt = useCallback(
    async (next: Session) => {
      sessionRef.current = next;
      store(config.storageKey, next);
      setSession(next);
      const me = await api.get("/v1/me", profileResponseSchema);
      setProfile(me.data);
      setStatus("signed_in");
    },
    [api, config.storageKey],
  );

  useEffect(() => {
    const saved = load(config.storageKey);
    if (!saved) {
      setStatus("signed_out");
      return;
    }
    adopt(saved).catch(() => {
      store(config.storageKey, null);
      setStatus("signed_out");
    });
  }, [adopt, config.storageKey]);

  // Expire the session in the UI exactly when the token does.
  useEffect(() => {
    if (!session) return;
    const ms = new Date(session.expiresAt).getTime() - Date.now();
    const timer = window.setTimeout(expire, Math.max(0, ms));
    return () => window.clearTimeout(timer);
  }, [session, expire]);

  const fromSupabase = useCallback(async () => {
    if (!supabase) throw new AuthUnavailableError();
    const { data } = await supabase.auth.getSession();
    const s = data.session;
    if (!s) throw new ApiError(401, "UNAUTHENTICATED", "Not signed in");
    const aal = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    await adopt({
      accessToken: s.access_token,
      expiresAt: new Date((s.expires_at ?? Date.now() / 1000 + 3600) * 1000).toISOString(),
      aal: aal.data?.currentLevel === "aal2" ? "aal2" : "aal1",
      source: "supabase",
    });
  }, [adopt, supabase]);

  const value = useMemo<AuthValue>(
    () => ({
      status,
      session,
      profile,
      api,
      config,
      supabaseReady: Boolean(supabase),
      supabase,
      devAccounts: async () =>
        (await api.get("/v1/dev-auth/accounts", devAccountListResponseSchema)).data,
      signInDev: async (userId, mfa) => {
        const res = await api.post("/v1/dev-auth/sessions", devSessionResponseSchema, {
          userId,
          mfa,
        });
        await adopt({
          accessToken: res.data.accessToken,
          expiresAt: res.data.expiresAt,
          aal: res.data.aal,
          source: "dev",
        });
      },
      signInPassword: async (email, password) => {
        if (!supabase) throw new AuthUnavailableError();
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        // Same message for unknown email and wrong password: no account enumeration.
        if (error) throw new ApiError(401, "UNAUTHENTICATED", "Email or password is not correct.");
        await fromSupabase();
      },
      signUpPassword: async (email, password, redirectTo) => {
        if (!supabase) throw new AuthUnavailableError();
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: redirectTo },
        });
        if (error) throw new ApiError(400, "VALIDATION_FAILED", error.message);
      },
      sendPasswordReset: async (email, redirectTo) => {
        if (!supabase) throw new AuthUnavailableError();
        // The answer is the same whether or not the address has an account.
        await supabase.auth.resetPasswordForEmail(email, { redirectTo });
      },
      updatePassword: async (password) => {
        if (!supabase) throw new AuthUnavailableError();
        const { error } = await supabase.auth.updateUser({ password });
        if (error) throw new ApiError(400, "VALIDATION_FAILED", error.message);
      },
      mfaEnroll: async () => {
        if (!supabase) throw new AuthUnavailableError();
        const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp" });
        if (error || !data)
          throw new ApiError(400, "BAD_REQUEST", error?.message ?? "Enrolment failed");
        return { factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret };
      },
      mfaFactors: async () => {
        if (!supabase) throw new AuthUnavailableError();
        const { data } = await supabase.auth.mfa.listFactors();
        return (data?.totp ?? []).map((f) => ({ id: f.id, status: f.status }));
      },
      mfaVerify: async (factorId, code) => {
        if (!supabase) throw new AuthUnavailableError();
        const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code });
        if (error) throw new ApiError(400, "VALIDATION_FAILED", "That code is not correct.");
        await fromSupabase();
      },
      signOut: async () => {
        if (session?.source === "supabase" && supabase) await supabase.auth.signOut();
        sessionRef.current = null;
        store(config.storageKey, null);
        setSession(null);
        setProfile(null);
        setStatus("signed_out");
      },
      refreshProfile: async () => {
        const me = await api.get("/v1/me", profileResponseSchema);
        setProfile(me.data);
      },
    }),
    [status, session, profile, api, config, supabase, adopt, fromSupabase],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth outside AuthProvider");
  return value;
}

export function useApi(): ApiClient {
  return useAuth().api;
}
