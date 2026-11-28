"use client";
import {
  branchExceptionResponseSchema,
  branchSlotsResponseSchema,
  merchantBranchResponseSchema,
  type MerchantBranch,
} from "@beans/contracts";
import {
  ActionError,
  Banner,
  Button,
  Card,
  Checkbox,
  ConfirmDialog,
  DataTable,
  PageHeader,
  QueryView,
  StatusChip,
  TextField,
  dubaiToday,
  formatTime,
  useAction,
  useApi,
  useI18n,
  useQuery,
  useToast,
} from "@beans/web";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import { branchName } from "../../../../lib/data";
import { BranchFields, bodyFrom, draftFrom } from "../branch-form";

export default function BranchDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { t, locale } = useI18n();
  const api = useApi();
  const query = useQuery(
    async (signal) =>
      (
        await api.get(
          `/v1/merchant/branches/${id}`,
          merchantBranchResponseSchema,
          undefined,
          signal,
        )
      ).data,
    [id],
  );
  return (
    <QueryView query={query}>
      {(branch) => (
        <>
          <PageHeader
            title={branchName(branch, locale)}
            subtitle={branch.address}
            actions={
              <Link href="/branches" className="btn btn-ghost">
                {t("common.back")}
              </Link>
            }
          />
          <div className="stack">
            <StatusCard branch={branch} onChanged={query.reload} />
            <EditCard
              key={`${branch.id}-${JSON.stringify(branch.hours)}`}
              branch={branch}
              onSaved={query.reload}
            />
            <ExceptionsCard branch={branch} onChanged={query.reload} />
            <SlotsCard branch={branch} />
          </div>
        </>
      )}
    </QueryView>
  );
}

function StatusCard({ branch, onChanged }: { branch: MerchantBranch; onChanged: () => void }) {
  const { t } = useI18n();
  const api = useApi();
  const toast = useToast();
  const [confirm, setConfirm] = useState<null | "active" | "paused" | "closed">(null);
  const change = useAction(async (status: "active" | "paused" | "closed") => {
    await api.patch(`/v1/merchant/branches/${branch.id}`, merchantBranchResponseSchema, { status });
    toast(t("common.saved"));
    setConfirm(null);
    onChanged();
  });
  const tone =
    branch.status === "active" ? "success" : branch.status === "paused" ? "warning" : "neutral";
  return (
    <Card
      title={t("branch.status")}
      actions={<StatusChip tone={tone}>{t(`branchStatus.${branch.status}`)}</StatusChip>}
    >
      <p className="muted">{t(`branch.statusHelp.${branch.status}`)}</p>
      <div className="row">
        {branch.status !== "active" && branch.status !== "closed" ? (
          <Button onClick={() => setConfirm("active")} data-testid="branch-activate">
            {branch.status === "paused" ? t("branch.resume") : t("branch.activate")}
          </Button>
        ) : null}
        {branch.status === "active" ? (
          <Button
            variant="secondary"
            onClick={() => setConfirm("paused")}
            data-testid="branch-pause"
          >
            {t("branch.pause")}
          </Button>
        ) : null}
        {branch.status !== "closed" ? (
          <Button variant="destructive" onClick={() => setConfirm("closed")}>
            {t("branch.close")}
          </Button>
        ) : null}
      </div>
      <ConfirmDialog
        open={confirm !== null}
        title={confirm ? t(`branch.confirm.${confirm}`) : ""}
        body={confirm ? <p>{t(`branch.confirmBody.${confirm}`)}</p> : null}
        confirmLabel={t("common.confirm")}
        destructive={confirm === "closed"}
        onConfirm={() => confirm && void change.run(confirm)}
        onClose={() => setConfirm(null)}
        pending={change.pending}
        error={change.error}
      />
    </Card>
  );
}

function EditCard({ branch, onSaved }: { branch: MerchantBranch; onSaved: () => void }) {
  const { t } = useI18n();
  const api = useApi();
  const toast = useToast();
  const [draft, setDraft] = useState(draftFrom(branch));
  const save = useAction(async (e: FormEvent) => {
    e.preventDefault();
    await api.patch(
      `/v1/merchant/branches/${branch.id}`,
      merchantBranchResponseSchema,
      bodyFrom(draft),
    );
    toast(t("common.saved"));
    onSaved();
  });
  return (
    <Card title={t("branch.details")}>
      <form onSubmit={(e) => void save.run(e)} noValidate>
        <BranchFields draft={draft} onChange={setDraft} errors={save.error?.fieldErrors ?? {}} />
        <ActionError error={save.error} />
        <Button type="submit" loading={save.pending} data-testid="save-branch">
          {t("common.save")}
        </Button>
      </form>
    </Card>
  );
}

function ExceptionsCard({ branch, onChanged }: { branch: MerchantBranch; onChanged: () => void }) {
  const { t } = useI18n();
  const api = useApi();
  const toast = useToast();
  const [date, setDate] = useState(dubaiToday(1));
  const [closed, setClosed] = useState(true);
  const [opens, setOpens] = useState("09:00");
  const [closes, setCloses] = useState("14:00");
  const save = useAction(async (e: FormEvent) => {
    e.preventDefault();
    await api.put(
      `/v1/merchant/branches/${branch.id}/exceptions/${date}`,
      branchExceptionResponseSchema,
      { closed, intervals: closed ? [] : [{ opens, closes }] },
    );
    toast(t("common.saved"));
    onChanged();
  });
  return (
    <Card title={t("branch.exceptions")}>
      <p className="muted">{t("branch.exceptionsHint")}</p>
      {branch.exceptions.length ? (
        <DataTable
          caption={t("branch.exceptions")}
          rows={branch.exceptions}
          rowKey={(x) => x.date}
          columns={[
            { key: "date", header: t("branch.date"), render: (x) => x.date },
            {
              key: "hours",
              header: t("branch.hours"),
              render: (x) =>
                x.closed
                  ? t("branch.closedAllDay")
                  : x.intervals.map((i) => `${i.opens}–${i.closes}`).join(", "),
            },
          ]}
        />
      ) : null}
      <form
        onSubmit={(e) => void save.run(e)}
        className="row"
        style={{ alignItems: "flex-end", marginTop: 12 }}
      >
        <TextField
          label={t("branch.date")}
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />
        <Checkbox label={t("branch.closedAllDay")} checked={closed} onChange={setClosed} />
        {!closed ? (
          <>
            <TextField
              label={t("branch.opens")}
              type="time"
              value={opens}
              onChange={(e) => setOpens(e.target.value)}
            />
            <TextField
              label={t("branch.closes")}
              type="time"
              value={closes}
              onChange={(e) => setCloses(e.target.value)}
            />
          </>
        ) : null}
        <Button type="submit" loading={save.pending}>
          {t("branch.saveException")}
        </Button>
      </form>
      <ActionError error={save.error} />
    </Card>
  );
}

function SlotsCard({ branch }: { branch: MerchantBranch }) {
  const { t, locale } = useI18n();
  const api = useApi();
  const [date, setDate] = useState(dubaiToday());
  const slots = useQuery(
    async (signal) =>
      (
        await api.get(
          `/v1/merchant/branches/${branch.id}/slots`,
          branchSlotsResponseSchema,
          { date },
          signal,
        )
      ).data,
    [branch.id, date],
  );
  return (
    <Card
      title={t("branch.slots")}
      actions={
        <TextField
          label={t("branch.date")}
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />
      }
    >
      <Banner tone="info">{t("branch.slotsHint")}</Banner>
      <QueryView query={slots}>
        {(d) => (
          <DataTable
            caption={t("branch.slots")}
            rows={d.slots}
            rowKey={(s) => s.id}
            emptyText={t("branch.noSlots")}
            columns={[
              {
                key: "time",
                header: t("branch.time"),
                render: (s) => formatTime(s.startsAt, locale),
              },
              {
                key: "cap",
                header: t("branch.capacity"),
                render: (s) => s.capacity,
                className: "num",
              },
              {
                key: "held",
                header: t("branch.held"),
                render: (s) => s.reserved,
                className: "num",
              },
              {
                key: "conf",
                header: t("branch.confirmed"),
                render: (s) => s.confirmed,
                className: "num",
              },
            ]}
          />
        )}
      </QueryView>
    </Card>
  );
}
