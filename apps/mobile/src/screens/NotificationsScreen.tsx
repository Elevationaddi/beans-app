import { View } from "react-native";
import { Body, Button, Heading, RemoteState, Screen, styles } from "../components/ui";
import { localized, useI18n } from "../i18n";
import { api, call } from "../lib/api";
import { useAction } from "../lib/use-action";
import { useRemote } from "../lib/use-remote";

/** C14: in-app inbox (announcements and order messages). No push notifications in this build. */
export function NotificationsScreen() {
  const { t, locale } = useI18n();
  const inbox = useRemote(
    async () => await call(api.GET("/v1/me/notifications", { params: { query: { limit: 50 } } })),
    [],
  );
  const readAll = useAction(async () => {
    await call(api.POST("/v1/me/notifications/read-all"));
    inbox.reload();
  });
  const read = useAction(async (id: string) => {
    await call(api.POST("/v1/me/notifications/{id}/read", { params: { path: { id } } }));
    inbox.reload();
  });
  return (
    <Screen testID="notifications">
      <Heading>{t("notifications.title")}</Heading>
      <RemoteState
        remote={inbox}
        isEmpty={(r) => r.data.length === 0}
        empty={<Body>{t("notifications.none")}</Body>}
      >
        {(result) => (
          <View style={{ gap: 8 }}>
            {result.unread > 0 ? (
              <Button
                label={t("notifications.readAll", { count: result.unread })}
                variant="secondary"
                onPress={() => void readAll.run()}
                disabled={readAll.pending}
                testID="read-all"
              />
            ) : null}
            {result.data.map((n) => (
              <View key={n.id} style={[styles.card, !n.readAt && { borderWidth: 2 }]}>
                <Heading
                  level={2}
                >{`${n.readAt ? "" : "● "}${localized(n.title, locale)}`}</Heading>
                <Body>{localized(n.body, locale)}</Body>
                <Body muted>{n.createdAt.slice(0, 10)}</Body>
                {!n.readAt ? (
                  <Button
                    label={t("notifications.markRead")}
                    variant="secondary"
                    onPress={() => void read.run(n.id)}
                  />
                ) : null}
              </View>
            ))}
          </View>
        )}
      </RemoteState>
    </Screen>
  );
}
