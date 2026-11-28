"use client";
import {
  inviteStaffResponseSchema,
  staffInvitationResponseSchema,
  staffListResponseSchema,
  staffMemberResponseSchema,
  type StaffMember,
} from "@beans/contracts";
import {
  ActionError,
  Banner,
  Button,
  Card,
  Checkbox,
  ConfirmDialog,
  DataTable,
  Dialog,
  PageHeader,
  QueryView,
  SelectField,
  StatusChip,
  TextField,
  formatDateTime,
  useAction,
  useApi,
  useI18n,
  useQuery,
  useToast,
} from "@beans/web";
import { useState } from "react";
import { branchName, useBranches } from "../../../lib/data";
import { useMerchant } from "../../../lib/merchant";

type Role = "manager" | "barista" | "analyst";

/** B07: invite staff, assign roles and branches, revoke. Each person has their own account. */
export default function StaffPage() {
  const { t, locale } = useI18n();
  const api = useApi();
  const toast = useToast();
  const { merchantId } = useMerchant();
  const branches = useBranches();
  const query = useQuery(
    async (signal) =>
      (await api.get("/v1/merchant/staff", staffListResponseSchema, { merchantId }, signal)).data,
    [merchantId],
    { enabled: Boolean(merchantId) },
  );
  const [inviting, setInviting] = useState(false);
  const [editing, setEditing] = useState<StaffMember | null>(null);
  const [revokeInvite, setRevokeInvite] = useState<string | null>(null);
  const names = (ids: string[]) =>
    ids.length === 0
      ? t("staff.allBranches")
      : ids
          .map((id) => {
            const b = branches.data?.find((x) => x.id === id);
            return b ? branchName(b, locale) : "?";
          })
          .join(", ");
  const revoke = useAction(async (id: string) => {
    await api.post(`/v1/merchant/staff/invitations/${id}/revoke`, staffInvitationResponseSchema);
    toast(t("staff.inviteRevoked"));
    setRevokeInvite(null);
    query.reload();
  });
  return (
    <>
      <PageHeader
        title={t("staff.title")}
        subtitle={t("staff.subtitle")}
        actions={
          <Button onClick={() => setInviting(true)} data-testid="invite-staff">
            {t("staff.invite")}
          </Button>
        }
      />
      <QueryView query={query}>
        {(d) => (
          <div className="stack">
            <Card title={t("staff.members")}>
              <DataTable
                caption={t("staff.members")}
                rows={d.members}
                rowKey={(m) => m.id}
                onRowClick={(m) => m.role !== "owner" && setEditing(m)}
                emptyText={t("staff.noMembers")}
                columns={[
                  {
                    key: "name",
                    header: t("staff.name"),
                    render: (m) => m.displayName ?? m.email ?? "—",
                  },
                  { key: "role", header: t("staff.role"), render: (m) => t(`role.${m.role}`) },
                  {
                    key: "branches",
                    header: t("staff.branches"),
                    render: (m) => names(m.branchIds),
                  },
                  {
                    key: "cat",
                    header: t("staff.catalog"),
                    render: (m) =>
                      m.catalogDelegated || m.role === "owner" ? t("common.yes") : t("common.no"),
                  },
                  {
                    key: "status",
                    header: t("menu.status"),
                    render: (m) => (
                      <StatusChip
                        tone={
                          m.status === "active"
                            ? "success"
                            : m.status === "revoked"
                              ? "error"
                              : "warning"
                        }
                      >
                        {t(`memberStatus.${m.status}`)}
                      </StatusChip>
                    ),
                  },
                ]}
              />
            </Card>
            <Card title={t("staff.invitations")}>
              <DataTable
                caption={t("staff.invitations")}
                rows={d.invitations}
                rowKey={(i) => i.id}
                emptyText={t("staff.noInvites")}
                columns={[
                  { key: "email", header: t("auth.email"), render: (i) => i.email },
                  { key: "role", header: t("staff.role"), render: (i) => t(`role.${i.role}`) },
                  {
                    key: "exp",
                    header: t("staff.expires"),
                    render: (i) => formatDateTime(i.expiresAt, locale),
                  },
                  {
                    key: "status",
                    header: t("menu.status"),
                    render: (i) => (
                      <StatusChip
                        tone={
                          i.status === "pending"
                            ? "warning"
                            : i.status === "accepted"
                              ? "success"
                              : "neutral"
                        }
                      >
                        {t(`inviteStatus.${i.status}`)}
                      </StatusChip>
                    ),
                  },
                  {
                    key: "act",
                    header: t("common.actions"),
                    render: (i) =>
                      i.status === "pending" ? (
                        <Button variant="ghost" onClick={() => setRevokeInvite(i.id)}>
                          {t("staff.revokeInvite")}
                        </Button>
                      ) : null,
                  },
                ]}
              />
            </Card>
          </div>
        )}
      </QueryView>
      {inviting ? <InviteDialog onClose={() => setInviting(false)} onDone={query.reload} /> : null}
      {editing ? (
        <MemberDialog
          member={editing}
          onClose={() => setEditing(null)}
          onDone={() => {
            setEditing(null);
            query.reload();
          }}
        />
      ) : null}
      <ConfirmDialog
        open={revokeInvite !== null}
        title={t("staff.revokeInvite")}
        confirmLabel={t("staff.revokeInvite")}
        destructive
        onConfirm={() => revokeInvite && void revoke.run(revokeInvite)}
        onClose={() => setRevokeInvite(null)}
        pending={revoke.pending}
        error={revoke.error}
      />
    </>
  );
}

function BranchPicker({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const { t, locale } = useI18n();
  const branches = useBranches();
  return (
    <fieldset className="field">
      <legend>{t("staff.branches")}</legend>
      <p className="hint">{t("staff.branchesHint")}</p>
      {(branches.data ?? []).map((b) => (
        <Checkbox
          key={b.id}
          label={branchName(b, locale)}
          checked={value.includes(b.id)}
          onChange={(on) => onChange(on ? [...value, b.id] : value.filter((x) => x !== b.id))}
        />
      ))}
    </fieldset>
  );
}

function InviteDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { t } = useI18n();
  const api = useApi();
  const { merchantId } = useMerchant();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("barista");
  const [branchIds, setBranchIds] = useState<string[]>([]);
  const [catalogDelegated, setCatalog] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  const send = useAction(async () => {
    const res = await api.post("/v1/merchant/staff", inviteStaffResponseSchema, {
      merchantId,
      email,
      role,
      branchIds,
      catalogDelegated,
    });
    setLink(`${window.location.origin}/invite?token=${encodeURIComponent(res.data.token)}`);
    onDone();
  });
  return (
    <Dialog
      open
      onClose={onClose}
      title={t("staff.invite")}
      footer={
        link ? (
          <Button onClick={onClose}>{t("common.close")}</Button>
        ) : (
          <>
            <Button variant="secondary" onClick={onClose}>
              {t("common.cancel")}
            </Button>
            <Button
              loading={send.pending}
              onClick={() => void send.run()}
              data-testid="send-invite"
            >
              {t("staff.sendInvite")}
            </Button>
          </>
        )
      }
    >
      {link ? (
        <>
          <Banner tone="success">{t("staff.inviteCreated")}</Banner>
          <p>{t("staff.inviteLinkHelp")}</p>
          <TextField
            label={t("staff.inviteLink")}
            value={link}
            readOnly
            onFocus={(e) => e.target.select()}
            data-testid="invite-link"
          />
        </>
      ) : (
        <>
          <TextField
            label={t("auth.email")}
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            error={send.error?.fieldErrors["email"]}
          />
          <SelectField
            label={t("staff.role")}
            value={role}
            onChange={(e) => setRole(e.target.value as Role)}
            options={(["manager", "barista", "analyst"] as const).map((r) => ({
              value: r,
              label: t(`role.${r}`),
            }))}
            hint={t(`staff.roleHelp.${role}`)}
          />
          <BranchPicker value={branchIds} onChange={setBranchIds} />
          {role === "manager" ? (
            <Checkbox
              label={t("staff.catalogDelegate")}
              checked={catalogDelegated}
              onChange={setCatalog}
            />
          ) : null}
          <ActionError error={send.error} />
        </>
      )}
    </Dialog>
  );
}

function MemberDialog({
  member,
  onClose,
  onDone,
}: {
  member: StaffMember;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useI18n();
  const api = useApi();
  const toast = useToast();
  const [role, setRole] = useState<Role>(member.role === "owner" ? "manager" : member.role);
  const [branchIds, setBranchIds] = useState(member.branchIds);
  const [catalogDelegated, setCatalog] = useState(member.catalogDelegated);
  const [revoking, setRevoking] = useState(false);
  const save = useAction(async (body: Record<string, unknown>) => {
    await api.patch(`/v1/merchant/staff/${member.id}`, staffMemberResponseSchema, body);
    toast(t("common.saved"));
    onDone();
  });
  return (
    <Dialog
      open
      onClose={onClose}
      title={member.displayName ?? member.email ?? t("staff.member")}
      footer={
        <>
          <Button
            variant="destructive"
            onClick={() => setRevoking(true)}
            disabled={member.status === "revoked"}
            data-testid="revoke-member"
          >
            {t("staff.revoke")}
          </Button>
          <Button
            loading={save.pending}
            onClick={() => void save.run({ role, branchIds, catalogDelegated })}
          >
            {t("common.save")}
          </Button>
        </>
      }
    >
      <SelectField
        label={t("staff.role")}
        value={role}
        onChange={(e) => setRole(e.target.value as Role)}
        options={(["manager", "barista", "analyst"] as const).map((r) => ({
          value: r,
          label: t(`role.${r}`),
        }))}
      />
      <BranchPicker value={branchIds} onChange={setBranchIds} />
      {role === "manager" ? (
        <Checkbox
          label={t("staff.catalogDelegate")}
          checked={catalogDelegated}
          onChange={setCatalog}
        />
      ) : null}
      <ActionError error={save.error} />
      <ConfirmDialog
        open={revoking}
        title={t("staff.revoke")}
        body={<p>{t("staff.revokeBody")}</p>}
        confirmLabel={t("staff.revoke")}
        destructive
        requireReason
        reasonLabel={t("staff.reason")}
        onConfirm={(reason) => void save.run({ status: "revoked", reason })}
        onClose={() => setRevoking(false)}
        pending={save.pending}
        error={save.error}
      />
    </Dialog>
  );
}
