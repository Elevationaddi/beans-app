"use client";
import { Banner, ConfirmDialog, useAction, useI18n, useToast } from "@beans/web";
import type { ReactNode } from "react";

export function NoAccess() {
  const { t } = useI18n();
  return <Banner tone="warning">{t("common.forbidden")}</Banner>;
}

/**
 * Every admin decision carries a written reason that goes to the audit log. This dialog asks
 * for it, runs the action once (no double submit) and shows the API's error if it is refused.
 */
export function ReasonDialog({
  title,
  body,
  confirmLabel,
  destructive,
  onConfirm,
  onClose,
  onDone,
}: {
  title: string;
  body?: ReactNode;
  confirmLabel: string;
  destructive?: boolean;
  onConfirm: (reason: string) => Promise<unknown>;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useI18n();
  const toast = useToast();
  const action = useAction(async (reason: string) => {
    await onConfirm(reason);
    toast(t("common.saved"));
    onDone();
  });
  return (
    <ConfirmDialog
      open
      title={title}
      body={body}
      confirmLabel={confirmLabel}
      destructive={destructive ?? false}
      requireReason
      reasonLabel={t("common.reason")}
      onConfirm={(reason) => void action.run(reason)}
      onClose={onClose}
      pending={action.pending}
      error={action.error}
    />
  );
}

export function JsonBlock({ value }: { value: unknown }) {
  if (value === null || value === undefined) return <span className="muted">—</span>;
  return <pre className="json">{JSON.stringify(value, null, 2)}</pre>;
}
