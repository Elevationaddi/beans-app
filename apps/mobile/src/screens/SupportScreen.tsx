import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import {
  Body,
  Button,
  Chip,
  FailureText,
  Field,
  Heading,
  RemoteState,
  Screen,
  StatusChip,
  styles,
} from "../components/ui";
import { useI18n } from "../i18n";
import { api, call } from "../lib/api";
import { useAction } from "../lib/use-action";
import { useRemote } from "../lib/use-remote";
import type { RootScreen } from "../navigation/types";

type Category = "order_issue" | "payment" | "account" | "other";
const CATEGORIES: Category[] = ["order_issue", "payment", "account", "other"];

/** C13: help requests to the platform, optionally about an order, and their replies. */
export function SupportScreen({ navigation, route }: RootScreen<"Support">) {
  const { t } = useI18n();
  const orderId = route.params?.orderId;
  const [category, setCategory] = useState<Category>(orderId ? "order_issue" : "other");
  const [message, setMessage] = useState("");
  const tickets = useRemote(
    async () => (await call(api.GET("/v1/tickets", { params: { query: { limit: 50 } } }))).data,
    [],
  );
  const create = useAction(async () => {
    const created = await call(
      api.POST("/v1/tickets", {
        body: { category, message: message.trim(), ...(orderId && { orderId }) },
      }),
    );
    setMessage("");
    navigation.navigate("Ticket", { ticketId: created.data.id });
  });
  return (
    <Screen testID="support">
      <Heading>{t("support.title")}</Heading>
      <View style={styles.card}>
        <Heading level={2}>{t("support.new")}</Heading>
        {orderId ? <Body muted>{t("support.aboutOrder")}</Body> : null}
        <View style={styles.row} accessibilityRole="radiogroup">
          {CATEGORIES.map((c) => (
            <Chip
              key={c}
              role="radio"
              label={t(`ticketCategory.${c}`)}
              selected={category === c}
              onPress={() => setCategory(c)}
            />
          ))}
        </View>
        <Field
          label={t("support.message")}
          value={message}
          onChangeText={setMessage}
          multiline
          maxLength={4000}
          testID="support-message"
        />
        <Button
          label={t("support.send")}
          onPress={() => void create.run()}
          disabled={create.pending || !message.trim()}
          testID="support-send"
        />
        <FailureText failure={create.failure} />
      </View>
      <Heading level={2}>{t("support.yours")}</Heading>
      <RemoteState
        remote={tickets}
        isEmpty={(l) => l.length === 0}
        empty={<Body>{t("support.none")}</Body>}
      >
        {(list) => (
          <View style={{ gap: 8 }}>
            {list.map((ticket) => (
              <Pressable
                key={ticket.id}
                accessibilityRole="button"
                accessibilityLabel={`${t(`ticketCategory.${ticket.category}`)}, ${t(`ticketStatus.${ticket.status}`)}`}
                onPress={() => navigation.navigate("Ticket", { ticketId: ticket.id })}
                style={styles.card}
              >
                <Text style={styles.h2}>{t(`ticketCategory.${ticket.category}`)}</Text>
                <StatusChip
                  label={t(`ticketStatus.${ticket.status}`)}
                  tone={
                    ticket.status === "open" || ticket.status === "pending" ? "warning" : "success"
                  }
                />
                <Body muted>{ticket.updatedAt.slice(0, 10)}</Body>
              </Pressable>
            ))}
          </View>
        )}
      </RemoteState>
    </Screen>
  );
}

export function TicketScreen({ route }: RootScreen<"Ticket">) {
  const { t } = useI18n();
  const { ticketId } = route.params;
  const [reply, setReply] = useState("");
  const ticket = useRemote(
    async () =>
      (await call(api.GET("/v1/tickets/{id}", { params: { path: { id: ticketId } } }))).data,
    [ticketId],
  );
  const send = useAction(async () => {
    await call(
      api.POST("/v1/tickets/{id}/messages", {
        params: { path: { id: ticketId } },
        body: { body: reply.trim(), visibility: "public" },
      }),
    );
    setReply("");
    ticket.reload();
  });
  return (
    <Screen testID="ticket">
      <RemoteState remote={ticket}>
        {(tk) => (
          <View style={{ gap: 8 }}>
            <Heading>{t(`ticketCategory.${tk.category}`)}</Heading>
            <StatusChip
              label={t(`ticketStatus.${tk.status}`)}
              tone={tk.status === "open" || tk.status === "pending" ? "warning" : "success"}
            />
            {tk.messages.map((m) => (
              <View key={m.id} style={styles.card}>
                <Body muted>{`${t(`author.${m.authorRole}`)} · ${m.createdAt.slice(0, 10)}`}</Body>
                <Body>{m.body}</Body>
              </View>
            ))}
            {tk.status !== "closed" ? (
              <>
                <Field
                  label={t("support.reply")}
                  value={reply}
                  onChangeText={setReply}
                  multiline
                  maxLength={4000}
                  testID="ticket-reply"
                />
                <Button
                  label={t("support.send")}
                  onPress={() => void send.run()}
                  disabled={send.pending || !reply.trim()}
                  testID="ticket-send"
                />
                <FailureText failure={send.failure} />
              </>
            ) : null}
          </View>
        )}
      </RemoteState>
    </Screen>
  );
}
