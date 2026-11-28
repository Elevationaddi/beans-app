"use client";
import { privacyExportResponseSchema, type TicketView } from "@beans/contracts";
import { ActionError, Banner, Button, PageHeader, useAction, useApi, useI18n } from "@beans/web";
import { useState } from "react";
import { useRoles } from "../../../lib/admin";
import { NoAccess } from "../../../lib/ui";
import { TicketQueue } from "../support/tickets";

/**
 * Privacy requests (access, deletion, correction) arrive as tickets in the privacy category.
 * An access request can be answered with an export of the person's data (each export audited).
 */
export default function PrivacyPage() {
  const { t } = useI18n();
  const { can } = useRoles();
  if (!can("support", "security")) return <NoAccess />;
  return (
    <>
      <PageHeader title={t("privacy.title")} subtitle={t("privacy.subtitle")} />
      <Banner tone="warning">{t("privacy.policyPending")}</Banner>
      {can("support", "operations") ? (
        <TicketQueue category="privacy" extra={(ticket) => <ExportPanel ticket={ticket} />} />
      ) : (
        <Banner tone="info">{t("privacy.securityOnly")}</Banner>
      )}
    </>
  );
}

function ExportPanel({ ticket }: { ticket: TicketView }) {
  const { t } = useI18n();
  const api = useApi();
  const [json, setJson] = useState<string | null>(null);
  const action = useAction(async () => {
    const result = await api.get(
      `/v1/admin/privacy-requests/${ticket.id}/export`,
      privacyExportResponseSchema,
    );
    setJson(JSON.stringify(result.data, null, 2));
  });
  if (ticket.privacyKind !== "access") return null;
  const download = () => {
    if (!json) return;
    const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `privacy-export-${ticket.id.slice(0, 8)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <div className="card">
      <p>{t("privacy.exportHint")}</p>
      <div className="row">
        <Button
          onClick={() => void action.run()}
          loading={action.pending}
          data-testid="privacy-export"
        >
          {t("privacy.export")}
        </Button>
        {json ? (
          <Button variant="secondary" onClick={download}>
            {t("privacy.download")}
          </Button>
        ) : null}
      </div>
      <ActionError error={action.error} />
      {json ? <pre className="json">{json}</pre> : null}
    </div>
  );
}
