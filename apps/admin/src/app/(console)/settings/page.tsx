"use client";
import {
  adminSettingsResponseSchema,
  platformSettingListResponseSchema,
  platformSettingResponseSchema,
  platformSettingSchemas,
  type PlatformSetting,
  type PlatformSettingValues,
} from "@beans/contracts";
import {
  ActionError,
  Banner,
  Button,
  Card,
  Checkbox,
  DataTable,
  DefinitionList,
  QueryView,
  PageHeader,
  StatusChip,
  TextField,
  formatDateTime,
  useAction,
  useApi,
  useI18n,
  useQuery,
  useToast,
} from "@beans/web";
import { useState, type ReactNode } from "react";
import { useRoles } from "../../../lib/admin";
import { NoAccess } from "../../../lib/ui";

/**
 * A09: platform settings. Operational timers (D10), the emergency pause and phase 9 feature
 * switches are versioned: every change needs a reason, is audited, and is refused (409) when
 * someone else saved first. Live payments and the wallet cannot be switched on here.
 */
export default function SettingsPage() {
  const { t } = useI18n();
  const api = useApi();
  const { can } = useRoles();
  const allowed = can("operations", "security", "marketing", "super_admin");
  const settings = useQuery(
    async (signal) =>
      (await api.get("/v1/admin/platform-settings", platformSettingListResponseSchema, {}, signal))
        .data,
    [],
    { enabled: allowed },
  );
  if (!allowed) return <NoAccess />;
  return (
    <>
      <PageHeader title={t("settings.title")} subtitle={t("settings.subtitle")} />
      <QueryView query={settings}>
        {(list) => {
          const by = Object.fromEntries(list.map((s) => [s.key, s])) as Record<
            PlatformSetting["key"],
            PlatformSetting
          >;
          return (
            <div className="stack">
              <PauseCard setting={by.pause} onSaved={settings.reload} />
              <OperationsCard setting={by.operations} onSaved={settings.reload} />
              <FeaturesCard setting={by.features} onSaved={settings.reload} />
            </div>
          );
        }}
      </QueryView>
      {can("operations", "security", "super_admin") ? <ServerSettings /> : null}
    </>
  );
}

/** Saves one key with the version it was read at and a reason for the audit log. */
function useSave(setting: PlatformSetting, onSaved: () => void) {
  const { t } = useI18n();
  const api = useApi();
  const toast = useToast();
  return useAction(async (value: unknown, reason: string) => {
    await api.put(`/v1/admin/platform-settings/${setting.key}`, platformSettingResponseSchema, {
      value,
      expectedVersion: setting.version,
      reason,
    });
    toast(t("common.saved"));
    onSaved();
  });
}

function SettingCard({
  setting,
  title,
  hint,
  children,
  value,
  valid,
  onSaved,
}: {
  setting: PlatformSetting;
  title: string;
  hint: string;
  children: (editable: boolean) => ReactNode;
  value: unknown;
  valid: boolean;
  onSaved: () => void;
}) {
  const { t, locale } = useI18n();
  const { can } = useRoles();
  const [reason, setReason] = useState("");
  const save = useSave(setting, () => {
    setReason("");
    onSaved();
  });
  const editable = can(...(setting.editableBy as Parameters<typeof can>));
  return (
    <Card
      title={title}
      actions={
        <span className="muted small">
          {t("settings.version", { version: setting.version })}
          {setting.updatedAt ? ` · ${formatDateTime(setting.updatedAt, locale)}` : ""}
        </span>
      }
    >
      <p className="muted">{hint}</p>
      {children(editable)}
      {editable ? (
        <div className="row" style={{ alignItems: "end" }}>
          <TextField
            label={t("common.reason")}
            value={reason}
            maxLength={500}
            onChange={(e) => setReason(e.target.value)}
            data-testid={`reason-${setting.key}`}
          />
          <Button
            loading={save.pending}
            disabled={!valid || reason.trim().length < 3}
            onClick={() => void save.run(value, reason.trim())}
            data-testid={`save-${setting.key}`}
          >
            {t("common.save")}
          </Button>
        </div>
      ) : (
        <p className="muted small">
          {t("settings.readOnly", {
            roles: setting.editableBy.map((r) => t(`role.${r}`)).join(", "),
          })}
        </p>
      )}
      <ActionError error={save.error} />
    </Card>
  );
}

function PauseCard({ setting, onSaved }: { setting: PlatformSetting; onSaved: () => void }) {
  const { t } = useI18n();
  const current = setting.value as PlatformSettingValues["pause"];
  const [paused, setPaused] = useState(current.ordersPaused);
  const [en, setEn] = useState(current.message?.en ?? "");
  const [ar, setAr] = useState(current.message?.ar ?? "");
  const value = {
    ordersPaused: paused,
    message: en.trim() ? { en: en.trim(), ...(ar.trim() ? { ar: ar.trim() } : {}) } : null,
  };
  return (
    <SettingCard
      setting={setting}
      title={t("settings.pause")}
      hint={t("settings.pauseHint")}
      value={value}
      valid={
        platformSettingSchemas.pause.safeParse(value).success && (!paused || Boolean(en.trim()))
      }
      onSaved={onSaved}
    >
      {(editable) => (
        <>
          {current.ordersPaused ? (
            <Banner tone="error">{t("settings.pausedNow")}</Banner>
          ) : (
            <Banner tone="success">{t("settings.openNow")}</Banner>
          )}
          <Checkbox
            label={t("settings.pauseToggle")}
            checked={paused}
            onChange={setPaused}
            disabled={!editable}
            testId="pause-toggle"
          />
          <div className="grid-2">
            <TextField
              label={t("settings.pauseMessageEn")}
              value={en}
              maxLength={200}
              disabled={!editable}
              onChange={(e) => setEn(e.target.value)}
              data-testid="pause-message-en"
            />
            <TextField
              label={t("settings.pauseMessageAr")}
              hint={t("common.arabicReview")}
              dir="rtl"
              lang="ar"
              value={ar}
              maxLength={200}
              disabled={!editable}
              onChange={(e) => setAr(e.target.value)}
            />
          </div>
        </>
      )}
    </SettingCard>
  );
}

const TIMERS = [
  { key: "acceptSeconds", unit: "seconds" },
  { key: "quoteSeconds", unit: "seconds" },
  { key: "holdSeconds", unit: "seconds" },
  { key: "invitationHours", unit: "hours" },
] as const;

function OperationsCard({ setting, onSaved }: { setting: PlatformSetting; onSaved: () => void }) {
  const { t } = useI18n();
  const current = setting.value as PlatformSettingValues["operations"];
  const [draft, setDraft] = useState<Record<string, string>>(() =>
    Object.fromEntries(Object.entries(current).map(([k, v]) => [k, String(v)])),
  );
  const value = Object.fromEntries(Object.entries(draft).map(([k, v]) => [k, Number(v)]));
  const parsed = platformSettingSchemas.operations.safeParse(value);
  const shape = platformSettingSchemas.operations.shape;
  return (
    <SettingCard
      setting={setting}
      title={t("settings.operations")}
      hint={t("settings.operationsHint")}
      value={value}
      valid={parsed.success}
      onSaved={onSaved}
    >
      {(editable) => (
        <div className="grid-2">
          {TIMERS.map(({ key, unit }) => {
            const field = shape[key];
            return (
              <TextField
                key={key}
                label={t(`settings.${key}`)}
                hint={t(`settings.range.${unit}`, {
                  min: field.minValue ?? 0,
                  max: field.maxValue ?? 0,
                })}
                type="number"
                inputMode="numeric"
                value={draft[key] ?? ""}
                disabled={!editable}
                onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))}
                error={
                  parsed.success
                    ? undefined
                    : parsed.error.issues.filter((i) => i.path[0] === key).map((i) => i.message)
                }
                data-testid={`timer-${key}`}
              />
            );
          })}
        </div>
      )}
    </SettingCard>
  );
}

const FEATURES = ["stampCards", "promotions", "dineIn", "sandboxGifts"] as const;

function FeaturesCard({ setting, onSaved }: { setting: PlatformSetting; onSaved: () => void }) {
  const { t } = useI18n();
  const current = setting.value as PlatformSettingValues["features"];
  const [draft, setDraft] = useState(current);
  return (
    <SettingCard
      setting={setting}
      title={t("settings.features")}
      hint={t("settings.featuresHint")}
      value={draft}
      valid
      onSaved={onSaved}
    >
      {(editable) => (
        <div className="stack">
          {FEATURES.map((f) => (
            <Checkbox
              key={f}
              label={t(`feature.${f}`)}
              checked={draft[f]}
              disabled={!editable}
              onChange={(v) => setDraft((d) => ({ ...d, [f]: v }))}
              testId={`feature-${f}`}
            />
          ))}
        </div>
      )}
    </SettingCard>
  );
}

/** Server switches and policy versions that are fixed by deployment, shown read only. */
function ServerSettings() {
  const { t, locale } = useI18n();
  const api = useApi();
  const query = useQuery(
    async (signal) =>
      (await api.get("/v1/admin/settings", adminSettingsResponseSchema, {}, signal)).data,
    [],
  );
  return (
    <Card title={t("settings.server")}>
      <p className="muted">{t("settings.serverHint")}</p>
      <QueryView query={query}>
        {(s) => (
          <>
            <DefinitionList
              items={[
                [t("settings.currency"), s.currency],
                [t("settings.timezone"), s.timezone],
                [t("settings.provider"), s.paymentProvider],
                ...Object.entries(s.features).map(
                  ([k, v]) =>
                    [
                      t(`serverFeature.${k}`),
                      <StatusChip key={k} tone={v ? "warning" : "neutral"}>
                        {v ? t("common.on") : t("common.off")}
                      </StatusChip>,
                    ] as [string, ReactNode],
                ),
              ]}
            />
            <h3>{t("settings.policies")}</h3>
            <DataTable
              caption={t("settings.policies")}
              rows={s.policies}
              rowKey={(p) => `${p.type}-${p.version}`}
              columns={[
                { key: "t", header: t("common.type"), render: (p) => p.type },
                { key: "v", header: t("settings.policyVersion"), render: (p) => p.version },
                {
                  key: "e",
                  header: t("settings.effective"),
                  render: (p) => formatDateTime(p.effectiveAt, locale),
                },
                {
                  key: "s",
                  header: t("settings.sandbox"),
                  render: (p) => (p.sandbox ? t("common.yes") : t("common.no")),
                },
              ]}
            />
          </>
        )}
      </QueryView>
    </Card>
  );
}
