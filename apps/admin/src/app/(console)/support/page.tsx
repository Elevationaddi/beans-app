"use client";
import { PageHeader, useI18n } from "@beans/web";
import { useRoles } from "../../../lib/admin";
import { NoAccess } from "../../../lib/ui";
import { TicketQueue } from "./tickets";

/** A06: customer and merchant support tickets, replies, internal notes and assignment. */
export default function SupportPage() {
  const { t } = useI18n();
  const { can } = useRoles();
  if (!can("support", "operations")) return <NoAccess />;
  return (
    <>
      <PageHeader title={t("support.title")} subtitle={t("support.subtitle")} />
      <TicketQueue />
    </>
  );
}
