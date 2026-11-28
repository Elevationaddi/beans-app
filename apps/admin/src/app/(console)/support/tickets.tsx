"use client";
import {
  ticketListResponseSchema,
  ticketResponseSchema,
  ticketStatusSchema,
  type TicketView,
} from "@beans/contracts";
import {
  ActionError,
  Button,
  DataTable,
  DefinitionList,
  Dialog,
  ErrorState,
  FilterBar,
  LoadMore,
  Loading,
  SelectField,
  StatusChip,
  TextArea,
  formatDateTime,
  useAction,
  useApi,
  useAuth,
  useI18n,
  usePaged,
  useQuery,
  useToast,
  type Tone,
} from "@beans/web";
import { useState, type ReactNode } from "react";
import { shortId, statusTone } from "../../../lib/admin";

const priorityTone: Record<string, Tone> = {
  low: "neutral",
  normal: "info",
  high: "warning",
  urgent: "error",
};

/** Shared ticket queue for support (all categories) and privacy requests (category privacy). */
export function TicketQueue({
  category,
  extra,
}: {
  category?: "privacy";
  extra?: (ticket: TicketView) => ReactNode;
}) {
  const { t, locale } = useI18n();
  const api = useApi();
  const [status, setStatus] = useState("open");
  const [openId, setOpenId] = useState<string | null>(null);
  const list = usePaged(
    (cursor, signal) =>
      api.get(
        "/v1/admin/tickets",
        ticketListResponseSchema,
        { status, category, cursor, limit: 25 },
        signal,
      ),
    [status, category],
  );
  const selected = list.items.find((i) => i.id === openId);
  return (
    <>
      <FilterBar>
        <SelectField
          label={t("common.status")}
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          options={[
            { value: "", label: t("common.all") },
            ...ticketStatusSchema.options.map((s) => ({
              value: s,
              label: t(`ticketStatus.${s}`),
            })),
          ]}
        />
      </FilterBar>
      {list.error ? <ErrorState error={list.error} onRetry={list.reload} /> : null}
      <DataTable<TicketView>
        caption={t("support.title")}
        rows={list.items}
        rowKey={(r) => r.id}
        onRowClick={(r) => setOpenId(r.id)}
        emptyText={list.loading ? t("common.loading") : t("support.empty")}
        columns={[
          { key: "id", header: t("support.ticket"), render: (r) => shortId(r.id) },
          { key: "ch", header: t("support.channel"), render: (r) => t(`channel.${r.channel}`) },
          {
            key: "cat",
            header: t("support.category"),
            render: (r) =>
              r.privacyKind
                ? `${t("ticketCategory.privacy")} · ${t(`privacyKind.${r.privacyKind}`)}`
                : t(`ticketCategory.${r.category}`),
          },
          {
            key: "p",
            header: t("support.priority"),
            render: (r) => (
              <StatusChip tone={priorityTone[r.priority]}>{t(`priority.${r.priority}`)}</StatusChip>
            ),
          },
          {
            key: "s",
            header: t("common.status"),
            render: (r) => (
              <StatusChip tone={statusTone[r.status]}>{t(`ticketStatus.${r.status}`)}</StatusChip>
            ),
          },
          {
            key: "a",
            header: t("support.assignee"),
            render: (r) => (r.assigneeId ? shortId(r.assigneeId) : t("support.unassigned")),
          },
          {
            key: "u",
            header: t("support.updated"),
            render: (r) => formatDateTime(r.updatedAt, locale),
          },
        ]}
      />
      <LoadMore hasMore={list.hasMore} loading={list.loading} onMore={() => void list.more()} />
      {openId ? (
        <TicketDialog
          id={openId}
          onClose={() => setOpenId(null)}
          onChanged={list.reload}
          extra={selected && extra ? extra(selected) : null}
        />
      ) : null}
    </>
  );
}

function TicketDialog({
  id,
  onClose,
  onChanged,
  extra,
}: {
  id: string;
  onClose: () => void;
  onChanged: () => void;
  extra: ReactNode;
}) {
  const { t, locale } = useI18n();
  const api = useApi();
  const toast = useToast();
  const { profile } = useAuth();
  const [body, setBody] = useState("");
  const [internal, setInternal] = useState(false);
  const detail = useQuery(
    async (signal) =>
      (await api.get(`/v1/admin/tickets/${id}`, ticketResponseSchema, {}, signal)).data,
    [id],
  );
  const reply = useAction(async () => {
    await api.post(`/v1/admin/tickets/${id}/messages`, ticketResponseSchema, {
      body: body.trim(),
      visibility: internal ? "internal" : "public",
    });
    setBody("");
    toast(t(internal ? "support.noteAdded" : "support.replied"));
    detail.reload();
    onChanged();
  });
  const update = useAction(async (change: Record<string, unknown>) => {
    await api.patch(`/v1/admin/tickets/${id}`, ticketResponseSchema, change);
    toast(t("common.saved"));
    detail.reload();
    onChanged();
  });
  const tk = detail.data;
  return (
    <Dialog open wide title={t("support.ticketTitle", { id: shortId(id) })} onClose={onClose}>
      {detail.error && !tk ? <ErrorState error={detail.error} onRetry={detail.reload} /> : null}
      {!tk && !detail.error ? <Loading /> : null}
      {tk ? (
        <>
          <DefinitionList
            items={[
              [t("support.channel"), t(`channel.${tk.channel}`)],
              [t("support.category"), t(`ticketCategory.${tk.category}`)],
              [t("finance.order"), shortId(tk.orderId)],
              [t("finance.merchant"), shortId(tk.merchantId)],
              [t("common.when"), formatDateTime(tk.createdAt, locale)],
            ]}
          />
          <FilterBar>
            <SelectField
              label={t("common.status")}
              value={tk.status}
              disabled={update.pending}
              onChange={(e) => void update.run({ status: e.target.value })}
              data-testid="ticket-status"
              options={ticketStatusSchema.options.map((s) => ({
                value: s,
                label: t(`ticketStatus.${s}`),
              }))}
            />
            <SelectField
              label={t("support.priority")}
              value={tk.priority}
              disabled={update.pending}
              onChange={(e) => void update.run({ priority: e.target.value })}
              options={["low", "normal", "high", "urgent"].map((p) => ({
                value: p,
                label: t(`priority.${p}`),
              }))}
            />
            {tk.assigneeId === profile?.id ? (
              <Button variant="secondary" onClick={() => void update.run({ assigneeId: null })}>
                {t("support.unassign")}
              </Button>
            ) : (
              <Button
                variant="secondary"
                onClick={() => void update.run({ assigneeId: profile?.id })}
                data-testid="ticket-assign-me"
              >
                {t("support.assignMe")}
              </Button>
            )}
          </FilterBar>
          <ActionError error={update.error} />
          {extra}
          <div className="thread" data-testid="ticket-thread">
            {tk.messages.map((m) => (
              <div key={m.id} className={`msg${m.visibility === "internal" ? " internal" : ""}`}>
                <p className="muted small">
                  {t(`author.${m.authorRole}`)} · {formatDateTime(m.createdAt, locale)}
                  {m.visibility === "internal" ? ` · ${t("support.internal")}` : ""}
                </p>
                <p style={{ whiteSpace: "pre-wrap" }}>{m.body}</p>
              </div>
            ))}
          </div>
          <TextArea
            label={internal ? t("support.internalNote") : t("support.reply")}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            maxLength={4000}
            data-testid="ticket-reply"
          />
          <div className="row">
            <label className="checkbox">
              <input
                type="checkbox"
                checked={internal}
                onChange={(e) => setInternal(e.target.checked)}
              />
              <span>{t("support.internalToggle")}</span>
            </label>
            <Button
              loading={reply.pending}
              disabled={!body.trim()}
              onClick={() => void reply.run()}
              data-testid="ticket-send"
            >
              {t("support.send")}
            </Button>
          </div>
          <ActionError error={reply.error} />
        </>
      ) : null}
    </Dialog>
  );
}
