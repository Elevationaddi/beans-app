import type { DevAccount } from "@beans/contracts";
import { useState } from "react";
import { View } from "react-native";
import {
  Body,
  Button,
  FailureText,
  Field,
  Heading,
  Notice,
  RemoteState,
  Screen,
  styles,
} from "../components/ui";
import { useI18n } from "../i18n";
import { config } from "../lib/config";
import { supabaseConfigured, type OtpTarget } from "../lib/supabase-auth";
import { useAction } from "../lib/use-action";
import { useRemote } from "../lib/use-remote";
import type { RootScreen } from "../navigation/types";
import { useAppState } from "../state/app-state";

/**
 * C01: sign in with a one-time code sent by email (Supabase Auth; cycle 3 removed SMS so no paid
 * SMS provider is needed). Recovery is the same flow: a new code to the account's email. Development builds also
 * list fictional test accounts; the API refuses that sign-in in production.
 */
export function SignInScreen({ navigation }: RootScreen<"SignIn">) {
  const { t } = useI18n();
  const { sendCode, verifyCode, sessionExpired } = useAppState();
  const [value, setValue] = useState("");
  const [code, setCode] = useState("");
  const [sentTo, setSentTo] = useState<OtpTarget | null>(null);
  const target: OtpTarget = { email: value.trim().toLowerCase() };
  const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
  const send = useAction(async () => {
    await sendCode(target);
    setSentTo(target);
  });
  const verify = useAction(async () => {
    if (!sentTo) return;
    await verifyCode(sentTo, code.trim());
    navigation.goBack();
  });

  return (
    <Screen testID="sign-in">
      <Heading>{t("auth.title")}</Heading>
      {sessionExpired ? <Notice tone="warning">{t("auth.expired")}</Notice> : null}
      {supabaseConfigured ? (
        <View style={styles.card}>
          {sentTo ? (
            <>
              <Body>{t("auth.codeSent", { to: sentTo.email })}</Body>
              <Field
                label={t("auth.code")}
                value={code}
                onChangeText={setCode}
                keyboardType="number-pad"
                autoComplete="one-time-code"
                maxLength={6}
                testID="otp-code"
              />
              <Button
                label={t("auth.verify")}
                onPress={() => void verify.run()}
                disabled={verify.pending || code.trim().length < 6}
                testID="otp-verify"
              />
              <FailureText failure={verify.failure} />
              <Button
                label={t("auth.changeEmail")}
                variant="secondary"
                onPress={() => setSentTo(null)}
              />
            </>
          ) : (
            <>
              <Field
                label={t("auth.email")}
                hint={t("auth.emailHint")}
                value={value}
                onChangeText={setValue}
                keyboardType="email-address"
                autoCapitalize="none"
                autoComplete="email"
                testID="otp-target"
              />
              <Button
                label={t("auth.sendCode")}
                onPress={() => void send.run()}
                disabled={send.pending || !valid}
                testID="otp-send"
              />
              <FailureText failure={send.failure} />
            </>
          )}
          <Body muted>{t("auth.terms")}</Body>
        </View>
      ) : (
        <Notice tone="warning">{t("auth.notConfigured")}</Notice>
      )}
      {config.devAuth ? <DevSignIn onDone={() => navigation.goBack()} /> : null}
    </Screen>
  );
}

function DevSignIn({ onDone }: { onDone: () => void }) {
  const { t } = useI18n();
  const { devAccounts, signInDev } = useAppState();
  const accounts = useRemote(
    async () => (await devAccounts()).filter((a: DevAccount) => a.kind === "customer"),
    [],
  );
  const signIn = useAction(async (userId: string) => {
    await signInDev(userId);
    onDone();
  });
  return (
    <View style={styles.card} testID="dev-sign-in">
      <Heading level={2}>{t("auth.devTitle")}</Heading>
      <Body muted>{t("auth.devBody")}</Body>
      <RemoteState
        remote={accounts}
        isEmpty={(list) => list.length === 0}
        empty={<Body>{t("auth.devNone")}</Body>}
      >
        {(list) => (
          <View style={{ gap: 8 }}>
            {list.map((a) => (
              <Button
                key={a.userId}
                variant="secondary"
                label={t("auth.devSignInAs", { name: a.displayName ?? a.email ?? a.phone ?? "" })}
                onPress={() => void signIn.run(a.userId)}
                disabled={signIn.pending || a.status !== "active"}
                testID={`dev-account-${a.email ?? a.userId}`}
              />
            ))}
          </View>
        )}
      </RemoteState>
      <FailureText failure={signIn.failure} />
    </View>
  );
}
