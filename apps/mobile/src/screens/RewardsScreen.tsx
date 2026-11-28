import { useState } from "react";
import { Share, View } from "react-native";
import {
  Body,
  Button,
  FailureText,
  Field,
  Heading,
  Notice,
  RemoteState,
  Screen,
  StatusChip,
  styles,
} from "../components/ui";
import { localized, useI18n } from "../i18n";
import { api, call } from "../lib/api";
import { formatFils } from "../lib/money";
import { newIdempotencyKey } from "../lib/session";
import { useAction } from "../lib/use-action";
import { useRemote } from "../lib/use-remote";
import type { RootScreen } from "../navigation/types";

/**
 * C10 and C11: the customer's stamps at each café, and gifts sent and received. Gifts are a
 * sandbox feature: no money moves, and the API refuses them in production.
 */
export function RewardsScreen({ route }: RootScreen<"Rewards">) {
  const { t, locale } = useI18n();
  const data = useRemote(async () => {
    const [stamps, gifts] = await Promise.all([
      call(api.GET("/v1/me/stamps")),
      // Gifts may be switched off; stamps still show.
      call(api.GET("/v1/gifts")).then(
        (r) => r.data,
        () => null,
      ),
    ]);
    return { stamps: stamps.data, gifts };
  }, []);
  const [code, setCode] = useState("");
  const [claimed, setClaimed] = useState<string | null>(null);
  const claim = useAction(async () => {
    const result = await call(
      api.POST("/v1/gifts/claim", {
        params: { header: { "Idempotency-Key": newIdempotencyKey() } },
        body: { token: code.trim() },
      }),
    );
    setClaimed(localized(result.data.productNames, locale));
    setCode("");
    data.reload();
  });
  const sent = route.params?.sentCode;

  return (
    <Screen testID="rewards">
      <Heading>{t("rewards.title")}</Heading>
      {sent ? (
        <View style={styles.card} testID="gift-sent">
          <Heading level={2}>{t("gifts.readyTitle")}</Heading>
          <Body>{t("gifts.readyBody")}</Body>
          <Body testID="gift-code">{sent}</Body>
          <Button
            label={t("gifts.share")}
            variant="secondary"
            onPress={() => void Share.share({ message: t("gifts.shareMessage", { code: sent }) })}
          />
        </View>
      ) : null}
      <RemoteState remote={data}>
        {({ stamps, gifts }) => (
          <View style={{ gap: 16 }}>
            <Heading level={2}>{t("rewards.stamps")}</Heading>
            {stamps.length === 0 ? <Body muted>{t("rewards.noStamps")}</Body> : null}
            {stamps.map((s) => (
              <View key={s.merchantId} style={styles.card} testID={`stamps-${s.merchantId}`}>
                <Heading level={2}>{s.brandName}</Heading>
                {s.card ? (
                  <>
                    <Body>
                      {t("rewards.progress", {
                        have: Math.max(0, s.balance),
                        need: s.card.stampsRequired,
                      })}
                    </Body>
                    <Body muted>{localized(s.card.reward, locale)}</Body>
                    {s.rewardAvailable ? (
                      <Notice tone="success">{t("rewards.available")}</Notice>
                    ) : null}
                  </>
                ) : (
                  <Body muted>{t("rewards.noCard", { have: s.balance })}</Body>
                )}
              </View>
            ))}

            <Heading level={2}>{t("gifts.title")}</Heading>
            {gifts === null ? (
              <Body muted>{t("gifts.unavailable")}</Body>
            ) : (
              <>
                <Notice tone="warning">{t("gifts.sandbox")}</Notice>
                {claimed ? (
                  <Notice tone="success" testID="gift-claimed">
                    {t("gifts.claimed", { name: claimed })}
                  </Notice>
                ) : null}
                <Field
                  label={t("gifts.code")}
                  value={code}
                  onChangeText={setCode}
                  autoCapitalize="none"
                  autoCorrect={false}
                  testID="gift-claim-code"
                />
                <Button
                  label={t("gifts.claim")}
                  onPress={() => void claim.run()}
                  disabled={claim.pending || code.trim().length < 20}
                  testID="gift-claim"
                />
                <FailureText failure={claim.failure} />
                {gifts.length === 0 ? <Body muted>{t("gifts.none")}</Body> : null}
                {gifts.map((g) => (
                  <View key={g.id} style={styles.card} testID={`gift-${g.id}`}>
                    <Body>{`${localized(g.productNames, locale)} · ${g.brandName}`}</Body>
                    <Body muted>
                      {t(g.role === "sent" ? "gifts.sentLine" : "gifts.receivedLine", {
                        value: formatFils(g.valueFils, locale),
                        date: g.expiresAt.slice(0, 10),
                      })}
                    </Body>
                    {g.message ? <Body>{`“${g.message}”`}</Body> : null}
                    <StatusChip
                      label={t(`gifts.status.${g.status}`)}
                      tone={
                        g.status === "claimed"
                          ? "success"
                          : g.status === "expired"
                            ? "error"
                            : "warning"
                      }
                    />
                  </View>
                ))}
              </>
            )}
          </View>
        )}
      </RemoteState>
    </Screen>
  );
}
