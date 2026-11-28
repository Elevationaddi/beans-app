"use client";
import {
  adminAccountListResponseSchema,
  adminAccountResponseSchema,
  adminRoleSchema,
  type AdminAccount,
} from "@beans/contracts";
import {
  ActionError,
  Banner,
  Button,
  Card,
  Checkbox,
  DataTable,
  PageHeader,
  QueryView,
  SelectField,
  StatusChip,
  TextField,
  useAction,
  useApi,
  useAuth,
  useI18n,
  useQuery,
  useToast,
} from "@beans/web";
import { useState } from "react";
import { statusTone, useRoles, type AdminRole } from "../../../lib/admin";
import { NoAccess, ReasonDialog } from "../../../lib/ui";

/**
 * A10: admin accounts and roles. Only a super admin grants or removes roles, never on their own
 * account, and the last super admin cannot be removed. Security can review the list.
 */
export default function AdminsPage() {
  const { t } = useI18n();
  const api = useApi();
  const { can } = useRoles();
  const { profile } = useAuth();
  const allowed = can("super_admin", "security");
  const [removing, setRemoving] = useState<{ account: AdminAccount; role: AdminRole } | null>(null);
  const list = useQuery(
    async (signal) =>
      (await api.get("/v1/admin/admins", adminAccountListResponseSchema, {}, signal)).data,
    [],
    { enabled: allowed },
  );
  if (!allowed) return <NoAccess />;
  const manage = can("super_admin");
  return (
    <>
      <PageHeader title={t("admins.title")} subtitle={t("admins.subtitle")} />
      <Banner tone="info">{t("admins.mfaNote")}</Banner>
      <QueryView query={list}>
        {(rows) => (
          <DataTable<AdminAccount>
            caption={t("admins.title")}
            rows={rows}
            rowKey={(r) => r.userId}
            columns={[
              { key: "n", header: t("common.name"), render: (r) => r.displayName ?? "—" },
              { key: "e", header: t("common.email"), render: (r) => r.email ?? "—" },
              {
                key: "s",
                header: t("common.status"),
                render: (r) => (
                  <StatusChip tone={statusTone[r.status]}>{t(`userStatus.${r.status}`)}</StatusChip>
                ),
              },
              {
                key: "r",
                header: t("admins.roles"),
                render: (r) => (
                  <span className="row">
                    {r.roles.map((role) => (
                      <span key={role} className="chip chip-info">
                        {t(`role.${role}`)}
                        {manage && r.userId !== profile?.id ? (
                          <button
                            className="link"
                            aria-label={t("admins.removeRole", { role: t(`role.${role}`) })}
                            onClick={() => setRemoving({ account: r, role })}
                          >
                            {" "}
                            ×
                          </button>
                        ) : null}
                      </span>
                    ))}
                  </span>
                ),
              },
            ]}
          />
        )}
      </QueryView>
      {manage ? <GrantCard onDone={list.reload} /> : null}
      {removing && removing.account.email ? (
        <ReasonDialog
          title={t("admins.removeRole", { role: t(`role.${removing.role}`) })}
          body={<p>{removing.account.email}</p>}
          confirmLabel={t("common.remove")}
          destructive
          onConfirm={(reason) =>
            api.post("/v1/admin/admins/roles", adminAccountResponseSchema, {
              email: removing.account.email,
              role: removing.role,
              grant: false,
              reason,
            })
          }
          onClose={() => setRemoving(null)}
          onDone={() => {
            setRemoving(null);
            list.reload();
          }}
        />
      ) : null}
    </>
  );
}

function GrantCard({ onDone }: { onDone: () => void }) {
  const { t } = useI18n();
  const api = useApi();
  const toast = useToast();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<AdminRole>("support");
  const [reason, setReason] = useState("");
  const [understood, setUnderstood] = useState(false);
  const grant = useAction(async () => {
    await api.post("/v1/admin/admins/roles", adminAccountResponseSchema, {
      email: email.trim(),
      role,
      grant: true,
      reason: reason.trim(),
    });
    toast(t("admins.granted"));
    setEmail("");
    setReason("");
    setUnderstood(false);
    onDone();
  });
  return (
    <Card title={t("admins.grant")}>
      <p className="muted">{t("admins.grantHint")}</p>
      <div className="grid-2">
        <TextField
          label={t("common.email")}
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          data-testid="grant-email"
        />
        <SelectField
          label={t("admins.role")}
          value={role}
          onChange={(e) => setRole(e.target.value as AdminRole)}
          options={adminRoleSchema.options.map((r) => ({ value: r, label: t(`role.${r}`) }))}
        />
      </div>
      <TextField
        label={t("common.reason")}
        value={reason}
        maxLength={500}
        onChange={(e) => setReason(e.target.value)}
      />
      <Checkbox label={t("admins.confirmGrant")} checked={understood} onChange={setUnderstood} />
      <Button
        loading={grant.pending}
        disabled={!email.includes("@") || reason.trim().length < 3 || !understood}
        onClick={() => void grant.run()}
        data-testid="grant-submit"
      >
        {t("admins.grant")}
      </Button>
      <ActionError error={grant.error} />
    </Card>
  );
}
