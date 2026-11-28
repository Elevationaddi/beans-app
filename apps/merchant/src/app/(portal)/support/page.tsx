"use client";
import {
  merchantOrderListResponseSchema,
  ticketListResponseSchema,
  ticketResponseSchema,
  type TicketView,
} from "@beans/contracts";
import {
  ActionError,
  Banner,
  Button,
  Card,
  DataTable,
  Dialog,
  FilterBar,
  LoadMore,
  PageHeader,
  SelectField,
  StatusChip,
  TextArea,
  TextField,
  formatDateTime,
  useAction,
  useApi,
  useI18n,
  usePaged,
  useQuery,
  useToast,
  type Tone,
} from "@beans/web";
import { useState } from "react";
import { branchName, useBranches } from "../../../lib/data";
import { useMerchant } from "../../../lib/merchant";

const statusTone: Record<string, Tone> = {
  open: "warning",
  pending: "info",
  resolved: "success",
  closed: "neutral",
};
type Category = "order_issue" | "payment" | "account" | "merchant_support" | "other";

/**
 * B11: the business's support tickets with the platform, and refund requests. A refund request
 * is a ticket linked to the order; only platform finance staff can issue the refund (dual control).
 */
export default function SupportPage() {
  const { t, locale } = useI18n();
  const api = useApi();
  const { merchantId } = useMerchant();
  const [status, setStatus] = useState("");
  const [creating, setCreating] = useState<null | "ticket" | "refund">(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const list = usePaged(
    async (cursor, signal) =>
      api.get(
        "/v1/tickets",
        ticketListResponseSchema,
        { merchantId, status, cursor, limit: 25 },
        signal,
      ),
    [merchantId, status],
  );
  return (
    <>
      <PageHeader
        title={t("support.title")}
        subtitle={t("support.subtitle")}
        actions={
          <>
            <Button
              variant="secondary"
              onClick={() => setCreating("refund")}
              data-testid="request-refund"
            >
              {t("support.requestRefund")}
            </Button>
            <Button onClick={() => setCreating("ticket")} data-testid="new-ticket">
              {t("support.new")}
            </Button>
          </>
        }
      />
      <FilterBar>
        <SelectField
          label={t("menu.status")}
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          options={[
            { value: "", label: t("common.all") },
            ...["open", "pending", "resolved", "closed"].map((s) => ({
              value: s,
              label: t(`ticketStatus.${s}`),
            })),
          ]}
        />
      </FilterBar>
      <ActionError error={list.error} />
      <DataTable<TicketView>
        caption={t("support.title")}
        rows={list.items}
        rowKey={(r) => r.id}
        onRowClick={(r) => setOpenId(r.id)}
        emptyText={list.loading ? t("common.loading") : t("support.empty")}
        columns={[
          {
            key: "created",
            header: t("finance.when"),
            render: (r) => formatDateTime(r.createdAt, locale),
          },
          {
            key: "cat",
            header: t("support.category"),
            render: (r) => t(`ticketCategory.${r.category}`),
          },
          {
            key: "order",
            header: t("orders.number"),
            render: (r) => (r.orderId ? r.orderId.slice(0, 8) : "—"),
          },
          {
            key: "status",
            header: t("menu.status"),
            render: (r) => (
              <StatusChip tone={statusTone[r.status]}>{t(`ticketStatus.${r.status}`)}</StatusChip>
            ),
          },
          {
            key: "updated",
            header: t("support.updated"),
            render: (r) => formatDateTime(r.updatedAt, locale),
          },
        ]}
      />
      <LoadMore hasMore={list.hasMore} loading={list.loading} onMore={() => void list.more()} />
      {creating ? (
        <NewTicketDialog
          refund={creating === "refund"}
          onClose={() => setCreating(null)}
          onDone={(id) => {
            setCreating(null);
            list.reload();
            setOpenId(id);
          }}
        />
      ) : null}
      {openId ? (
        <TicketDialog id={openId} onClose={() => setOpenId(null)} onChanged={list.reload} />
      ) : null}
    </>
  );
}

function NewTicketDialog({
  refund,
  onClose,
  onDone,
}: {
  refund: boolean;
  onClose: () => void;
  onDone: (id: string) => void;
}) {
  const { t, locale } = useI18n();
  const api = useApi();
  const toast = useToast();
  const { merchantId } = useMerchant();
  const [category, setCategory] = useState<Category>(refund ? "payment" : "merchant_support");
  const branches = useBranches();
  const [branchId, setBranchId] = useState("");
  const [orderId, setOrderId] = useState("");
  const orders = useQuery(
    async (signal) =>
      (
        await api.get(
          "/v1/merchant/orders",
          merchantOrderListResponseSchema,
          { branchId, status: refund ? "completed" : undefined, limit: 50 },
          signal,
        )
      ).data,
    [branchId, refund],
    { enabled: Boolean(branchId) },
  );
  const [amount, setAmount] = useState("");
  const [message, setMessage] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const create = useAction(async () => {
    const body = refund
      ? `${t("support.refundPrefix", { amount: amount.trim() || "—" })}\n\n${message.trim()}`
      : message.trim();
    const res = await api.post("/v1/tickets", ticketResponseSchema, {
      category,
      message: body,
      merchantId,
      ...(orderId.trim() ? { orderId: orderId.trim() } : {}),
    });
    toast(t("support.created"));
    onDone(res.data.id);
  });
  const submit = () => {
    if (refund && !orderId.trim()) return setLocalError(t("support.orderRequired"));
    if (!message.trim()) return setLocalError(t("support.messageRequired"));
    setLocalError(null);
    void create.run();
  };
  return (
    <Dialog
      open
      title={refund ? t("support.requestRefund") : t("support.new")}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button onClick={submit} loading={create.pending} data-testid="ticket-submit">
            {t("support.send")}
          </Button>
        </>
      }
    >
      {refund ? <Banner tone="info">{t("support.refundNote")}</Banner> : null}
      {!refund ? (
        <SelectField
          label={t("support.category")}
          value={category}
          onChange={(e) => setCategory(e.target.value as Category)}
          options={(
            ["merchant_support", "order_issue", "payment", "account", "other"] as const
          ).map((c) => ({ value: c, label: t(`ticketCategory.${c}`) }))}
        />
      ) : null}
      <SelectField
        label={t("filter.branch")}
        value={branchId}
        onChange={(e) => {
          setBranchId(e.target.value);
          setOrderId("");
        }}
        options={[
          { value: "", label: t("support.chooseBranch") },
          ...(branches.data ?? []).map((b) => ({ value: b.id, label: branchName(b, locale) })),
        ]}
      />
      {branchId ? (
        <SelectField
          label={t("support.order")}
          hint={refund ? t("support.orderHintRefund") : t("support.orderHint")}
          value={orderId}
          onChange={(e) => setOrderId(e.target.value)}
          disabled={orders.loading}
          error={create.error?.fieldErrors["orderId"]}
          options={[
            {
              value: "",
              label: orders.loading
                ? t("common.loading")
                : refund
                  ? t("support.chooseOrder")
                  : t("support.noOrder"),
            },
            ...(orders.data ?? []).map((o) => ({
              value: o.id,
              label: `${o.publicNumber} · ${formatDateTime(o.createdAt, locale)}`,
            })),
          ]}
          data-testid="ticket-order"
        />
      ) : null}
      {refund ? (
        <TextField
          label={t("support.refundAmount")}
          hint={t("support.refundAmountHint")}
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
      ) : null}
      <TextArea
        label={t("support.message")}
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        rows={5}
        maxLength={3500}
        error={create.error?.fieldErrors["message"]}
      />
      {localError ? (
        <p className="field-error" role="alert">
          {localError}
        </p>
      ) : null}
      <ActionError error={create.error} />
    </Dialog>
  );
}

function TicketDialog({
  id,
  onClose,
  onChanged,
}: {
  id: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { t, locale } = useI18n();
  const api = useApi();
  const query = useQuery(
    async (signal) =>
      (await api.get(`/v1/tickets/${id}`, ticketResponseSchema, undefined, signal)).data,
    [id],
  );
  const [reply, setReply] = useState("");
  const send = useAction(async () => {
    await api.post(`/v1/tickets/${id}/messages`, ticketResponseSchema, { body: reply.trim() });
    setReply("");
    query.reload();
    onChanged();
  });
  const ticket = query.data;
  return (
    <Dialog open title={t("support.ticket")} onClose={onClose}>
      {query.error ? <ActionError error={query.error} /> : null}
      {!ticket ? (
        <p>{t("common.loading")}</p>
      ) : (
        <div className="stack">
          <p>
            <StatusChip tone={statusTone[ticket.status]}>
              {t(`ticketStatus.${ticket.status}`)}
            </StatusChip>{" "}
            {t(`ticketCategory.${ticket.category}`)}
          </p>
          <ol className="messages" aria-label={t("support.messages")}>
            {ticket.messages.map((m) => (
              <li key={m.id} className={`message message-${m.authorRole}`}>
                <div className="muted small">
                  {t(`support.author.${m.authorRole}`)} · {formatDateTime(m.createdAt, locale)}
                </div>
                <p className="pre">{m.body}</p>
              </li>
            ))}
          </ol>
          {ticket.status === "closed" ? (
            <p className="muted">{t("support.closed")}</p>
          ) : (
            <Card>
              <TextArea
                label={t("support.reply")}
                value={reply}
                onChange={(e) => setReply(e.target.value)}
                rows={3}
                maxLength={4000}
              />
              <ActionError error={send.error} />
              <Button
                onClick={() => void send.run()}
                disabled={!reply.trim()}
                loading={send.pending}
                data-testid="ticket-reply"
              >
                {t("support.send")}
              </Button>
            </Card>
          )}
        </div>
      )}
    </Dialog>
  );
}
