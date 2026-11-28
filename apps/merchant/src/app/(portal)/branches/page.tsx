"use client";
import { merchantBranchResponseSchema } from "@beans/contracts";
import {
  ActionError,
  Button,
  DataTable,
  Dialog,
  PageHeader,
  QueryView,
  StatusChip,
  useAction,
  useApi,
  useI18n,
  useToast,
} from "@beans/web";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { branchName, useBranches } from "../../../lib/data";
import { useMerchant } from "../../../lib/merchant";
import { BranchFields, bodyFrom, draftFrom } from "./branch-form";

/** B03: branches of the business. */
export default function BranchesPage() {
  const { t, locale } = useI18n();
  const branches = useBranches();
  const { isOwner } = useMerchant();
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  return (
    <>
      <PageHeader
        title={t("branches.title")}
        actions={
          isOwner ? (
            <Button onClick={() => setCreating(true)} data-testid="new-branch">
              {t("branches.new")}
            </Button>
          ) : null
        }
      />
      <QueryView query={branches}>
        {(rows) => (
          <DataTable
            caption={t("branches.title")}
            rows={rows}
            rowKey={(b) => b.id}
            onRowClick={(b) => router.push(`/branches/${b.id}`)}
            columns={[
              {
                key: "name",
                header: t("branch.name"),
                render: (b) => <Link href={`/branches/${b.id}`}>{branchName(b, locale)}</Link>,
              },
              {
                key: "city",
                header: t("branch.city"),
                render: (b) => (b.city ? t(`city.${b.city}`) : "—"),
              },
              {
                key: "modes",
                header: t("branch.modes"),
                render: (b) => b.modes.map((m) => t(`mode.${m}`)).join(", "),
              },
              {
                key: "status",
                header: t("branch.status"),
                render: (b) => (
                  <StatusChip
                    tone={
                      b.status === "active"
                        ? "success"
                        : b.status === "paused"
                          ? "warning"
                          : "neutral"
                    }
                  >
                    {t(`branchStatus.${b.status}`)}
                  </StatusChip>
                ),
              },
            ]}
            emptyText={t("branches.empty")}
          />
        )}
      </QueryView>
      <CreateBranch
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={(id) => router.push(`/branches/${id}`)}
      />
    </>
  );
}

function CreateBranch({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const { t } = useI18n();
  const api = useApi();
  const toast = useToast();
  const { merchantId } = useMerchant();
  const [draft, setDraft] = useState(draftFrom());
  const save = useAction(async (e?: FormEvent) => {
    e?.preventDefault();
    const res = await api.post("/v1/merchant/branches", merchantBranchResponseSchema, {
      merchantId,
      ...bodyFrom(draft),
    });
    toast(t("common.saved"));
    onCreated(res.data.id);
  });
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t("branches.new")}
      wide
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button loading={save.pending} onClick={() => void save.run()} data-testid="save-branch">
            {t("common.save")}
          </Button>
        </>
      }
    >
      <form onSubmit={(e) => void save.run(e)} noValidate>
        <BranchFields draft={draft} onChange={setDraft} errors={save.error?.fieldErrors ?? {}} />
        <ActionError error={save.error} />
      </form>
    </Dialog>
  );
}
