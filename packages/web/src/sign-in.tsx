"use client";
import type { DevAccount, Profile } from "@beans/contracts";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { ApiError } from "./api";
import { AuthUnavailableError, useAuth } from "./auth";
import {
  ActionError,
  Banner,
  Button,
  Card,
  Checkbox,
  LanguageToggle,
  Loading,
  Logo,
  TextField,
} from "./components";
import { useAction } from "./hooks";
import { useI18n } from "./i18n";
import type { brand } from "@beans/ui";

type Surface = keyof typeof brand.surfaces;

function AuthFrame({ surface, children }: { surface: Surface; children: ReactNode }) {
  return (
    <div className="auth-frame">
      <div className="auth-top">
        <Logo surface={surface} />
        <LanguageToggle />
      </div>
      <div className="auth-body">{children}</div>
    </div>
  );
}

/**
 * Shows `children` only to a signed-in person whom `allowed` accepts; otherwise the sign-in
 * screens. With `requireMfa`, a session without two-step verification is sent to the MFA step.
 */
export function AuthGate({
  surface,
  allowed,
  requireMfa,
  devFilter,
  children,
  links,
}: {
  surface: Surface;
  allowed: (profile: Profile) => boolean;
  requireMfa?: boolean;
  devFilter?: (account: DevAccount) => boolean;
  children: ReactNode;
  links?: ReactNode;
}) {
  const { status, profile, session, signOut } = useAuth();
  const { t } = useI18n();
  if (status === "loading") {
    return (
      <AuthFrame surface={surface}>
        <Loading />
      </AuthFrame>
    );
  }
  if (status === "signed_in" && profile) {
    if (!allowed(profile)) {
      return (
        <AuthFrame surface={surface}>
          <Card title={t("auth.noAccess")}>
            <Button variant="secondary" onClick={() => void signOut()}>
              {t("common.signOut")}
            </Button>
          </Card>
        </AuthFrame>
      );
    }
    if (requireMfa && session?.aal !== "aal2") {
      return (
        <AuthFrame surface={surface}>
          <MfaStep />
        </AuthFrame>
      );
    }
    return <>{children}</>;
  }
  return (
    <AuthFrame surface={surface}>
      {status === "expired" ? (
        <Banner tone="warning">
          <strong>{t("auth.expired.title")}.</strong> {t("auth.expired.body")}
        </Banner>
      ) : null}
      <SignInPanel requireMfa={requireMfa ?? false} {...(devFilter ? { devFilter } : {})} />
      {links}
    </AuthFrame>
  );
}

export function SignInPanel({
  requireMfa,
  devFilter,
}: {
  requireMfa: boolean;
  devFilter?: (a: DevAccount) => boolean;
}) {
  const { t } = useI18n();
  const { signInPassword, supabaseReady, config } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const action = useAction(async (e: FormEvent) => {
    e.preventDefault();
    await signInPassword(email.trim(), password);
  });
  return (
    <div className="auth-grid">
      <Card title={t("auth.title")}>
        {supabaseReady ? (
          <form onSubmit={(e) => void action.run(e)} noValidate>
            <TextField
              label={t("auth.email")}
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
            <TextField
              label={t("auth.password")}
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
            <ActionError error={action.error} />
            <Button type="submit" loading={action.pending} size="lg">
              {t("auth.signIn")}
            </Button>
            <p>
              <a href="/account/reset">{t("auth.forgot")}</a>
            </p>
          </form>
        ) : (
          <Banner tone="warning">{t("auth.unavailable")}</Banner>
        )}
        <p className="muted small">{t("auth.recovery")}</p>
      </Card>
      {config.devAuth ? (
        <DevSignIn requireMfa={requireMfa} {...(devFilter ? { filter: devFilter } : {})} />
      ) : null}
    </div>
  );
}

function DevSignIn({
  requireMfa,
  filter,
}: {
  requireMfa: boolean;
  filter?: (a: DevAccount) => boolean;
}) {
  const { t } = useI18n();
  const { devAccounts, signInDev } = useAuth();
  const [accounts, setAccounts] = useState<DevAccount[] | null>(null);
  const [loadError, setLoadError] = useState<ApiError | null>(null);
  const [mfa, setMfa] = useState(requireMfa);
  const action = useAction((userId: string) => signInDev(userId, mfa));
  useEffect(() => {
    devAccounts()
      .then((list) => setAccounts(filter ? list.filter(filter) : list))
      .catch((e: unknown) =>
        setLoadError(e instanceof ApiError ? e : new ApiError(0, "OFFLINE", String(e))),
      );
  }, [devAccounts, filter]);
  return (
    <Card title={t("auth.dev.title")} className="dev-card">
      <p className="muted small">{t("auth.dev.body")}</p>
      <Checkbox label={t("auth.dev.mfa")} checked={mfa} onChange={setMfa} testId="dev-mfa" />
      {loadError ? <ActionError error={loadError} /> : null}
      {accounts === null && !loadError ? <Loading /> : null}
      {accounts && accounts.length === 0 ? <p>{t("auth.dev.none")}</p> : null}
      <ul className="dev-accounts">
        {accounts?.map((a) => (
          <li key={a.userId}>
            <Button
              variant="secondary"
              onClick={() => void action.run(a.userId)}
              disabled={action.pending || a.status !== "active"}
              data-testid={`dev-account-${a.email ?? a.phone ?? a.userId}`}
            >
              {t("auth.dev.signInAs", { name: a.displayName ?? a.email ?? a.userId })}
            </Button>
            <span className="muted small">
              {[a.kind, ...a.membershipRoles, ...a.adminRoles].join(" · ")}
              {a.status !== "active" ? ` · ${a.status}` : ""}
            </span>
          </li>
        ))}
      </ul>
      <ActionError error={action.error} />
    </Card>
  );
}

export function MfaStep() {
  const { t } = useI18n();
  const { mfaFactors, mfaEnroll, mfaVerify, supabaseReady, signOut, session } = useAuth();
  const [factor, setFactor] = useState<{ id: string; qr?: string; secret?: string } | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<ApiError | null>(null);
  useEffect(() => {
    if (!supabaseReady || session?.source !== "supabase") return;
    mfaFactors()
      .then(async (factors) => {
        const verified = factors.find((f) => f.status === "verified");
        if (verified) setFactor({ id: verified.id });
        else {
          const enrolled = await mfaEnroll();
          setFactor({ id: enrolled.factorId, qr: enrolled.qrCode, secret: enrolled.secret });
        }
      })
      .catch((e: unknown) =>
        setError(e instanceof ApiError ? e : new ApiError(0, "INTERNAL_ERROR", String(e))),
      );
  }, [supabaseReady, session?.source, mfaFactors, mfaEnroll]);
  const verify = useAction(async (e: FormEvent) => {
    e.preventDefault();
    if (factor) await mfaVerify(factor.id, code.trim());
  });
  return (
    <Card title={t("auth.mfa.title")}>
      <p>{t("auth.mfa.required")}</p>
      {session?.source === "dev" ? (
        <Banner tone="warning">
          {t("auth.dev.mfa")}: sign out and sign in again with the box ticked.
        </Banner>
      ) : null}
      {factor?.qr ? (
        <>
          <p>{t("auth.mfa.enrol")}</p>
          <img src={factor.qr} alt="" width={180} height={180} />
          <p className="muted small mono">{factor.secret}</p>
        </>
      ) : null}
      {factor ? (
        <form onSubmit={(e) => void verify.run(e)}>
          <TextField
            label={t("auth.mfa.code")}
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="\d{6}"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
          <Button type="submit" loading={verify.pending}>
            {t("auth.mfa.verify")}
          </Button>
        </form>
      ) : null}
      <ActionError error={verify.error ?? error} />
      <Button variant="ghost" onClick={() => void signOut()}>
        {t("common.signOut")}
      </Button>
    </Card>
  );
}

/** Password reset request, new password (after the emailed link) and business sign-up. */
export function AccountScreen({
  surface,
  mode,
  redirectTo,
}: {
  surface: Surface;
  mode: "reset" | "new-password" | "sign-up";
  redirectTo: string;
}) {
  const { t } = useI18n();
  const auth = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [done, setDone] = useState(false);
  const action = useAction(async (e: FormEvent) => {
    e.preventDefault();
    if (mode === "reset") await auth.sendPasswordReset(email.trim(), redirectTo);
    else if (mode === "new-password") await auth.updatePassword(password);
    else await auth.signUpPassword(email.trim(), password, redirectTo);
    setDone(true);
  });
  const title =
    mode === "reset"
      ? t("auth.reset.title")
      : mode === "new-password"
        ? t("auth.newPassword.title")
        : t("auth.signUp");
  const doneText =
    mode === "reset"
      ? t("auth.reset.sent")
      : mode === "new-password"
        ? t("auth.newPassword.done")
        : t("auth.signUp.sent");
  return (
    <AuthFrame surface={surface}>
      <Card title={title}>
        {!auth.supabaseReady ? <Banner tone="warning">{t("auth.unavailable")}</Banner> : null}
        {done ? (
          <Banner tone="success">{doneText}</Banner>
        ) : (
          <form onSubmit={(e) => void action.run(e)} noValidate>
            {mode !== "new-password" ? (
              <TextField
                label={t("auth.email")}
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            ) : null}
            {mode !== "reset" ? (
              <TextField
                label={t("auth.password")}
                hint={t("auth.passwordHint")}
                type="password"
                autoComplete="new-password"
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            ) : null}
            <ActionError
              error={
                action.error && !(action.error instanceof AuthUnavailableError)
                  ? action.error
                  : null
              }
            />
            <Button
              type="submit"
              loading={action.pending}
              disabled={!auth.supabaseReady || (mode !== "reset" && password.length < 8)}
            >
              {mode === "reset"
                ? t("auth.reset.send")
                : mode === "new-password"
                  ? t("auth.newPassword.save")
                  : t("auth.signUp")}
            </Button>
          </form>
        )}
        <p>
          <a href="?">{t("common.back")}</a>
        </p>
      </Card>
    </AuthFrame>
  );
}
