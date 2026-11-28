"use client";
import {
  homepageResponseSchema,
  platformSettingListResponseSchema,
  platformSettingResponseSchema,
  publicBranchListResponseSchema,
  type PlatformSetting,
  type PlatformSettingValues,
} from "@beans/contracts";
import {
  ActionError,
  Banner,
  Button,
  Card,
  PageHeader,
  QueryView,
  SelectField,
  TextField,
  useAction,
  useApi,
  useI18n,
  useQuery,
  useToast,
} from "@beans/web";
import { useState } from "react";
import { useRoles } from "../../../lib/admin";
import { NoAccess } from "../../../lib/ui";

/**
 * A07: homepage hero text and featured shops for the customer app. Only approved shops with a
 * listed branch can be chosen; the API checks again and drops any that stop being approved.
 */
export default function HomepagePage() {
  const { t } = useI18n();
  const api = useApi();
  const { can } = useRoles();
  const allowed = can("marketing", "super_admin");
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
      <PageHeader title={t("homepage.title")} subtitle={t("homepage.subtitle")} />
      <QueryView query={settings}>
        {(list) => {
          const setting = list.find((s) => s.key === "homepage");
          return setting ? (
            <HomepageEditor key={setting.version} setting={setting} onSaved={settings.reload} />
          ) : null;
        }}
      </QueryView>
    </>
  );
}

function HomepageEditor({ setting, onSaved }: { setting: PlatformSetting; onSaved: () => void }) {
  const { t } = useI18n();
  const api = useApi();
  const toast = useToast();
  const current = setting.value as PlatformSettingValues["homepage"];
  const [en, setEn] = useState(current.hero?.en ?? "");
  const [ar, setAr] = useState(current.hero?.ar ?? "");
  const [featured, setFeatured] = useState<string[]>(current.featuredMerchantIds);
  const [pick, setPick] = useState("");
  const [reason, setReason] = useState("");
  // Shops customers can see today (public listing), so the choice matches the app.
  const shops = useQuery(async (signal) => {
    const names = new Map<string, string>();
    let cursor: string | undefined;
    for (let i = 0; i < 5; i++) {
      const page = await api.get(
        "/v1/branches",
        publicBranchListResponseSchema,
        { limit: 50, cursor },
        signal,
      );
      for (const b of page.data) names.set(b.merchantId, b.brandName);
      if (!page.meta.nextCursor) break;
      cursor = page.meta.nextCursor;
    }
    return names;
  }, []);
  const preview = useQuery(
    async (signal) =>
      (await api.get("/v1/platform/homepage", homepageResponseSchema, {}, signal)).data,
    [setting.version],
  );
  const nameOf = (id: string) =>
    shops.data?.get(id) ??
    preview.data?.featured.find((f) => f.merchantId === id)?.brandName ??
    t("homepage.notListed");
  const save = useAction(async () => {
    await api.put("/v1/admin/platform-settings/homepage", platformSettingResponseSchema, {
      value: {
        hero: en.trim() ? { en: en.trim(), ...(ar.trim() ? { ar: ar.trim() } : {}) } : null,
        featuredMerchantIds: featured,
      },
      expectedVersion: setting.version,
      reason: reason.trim(),
    });
    toast(t("common.saved"));
    onSaved();
  });
  const move = (index: number, delta: number) =>
    setFeatured((list) => {
      const next = [...list];
      const target = index + delta;
      if (target < 0 || target >= next.length) return list;
      [next[index], next[target]] = [next[target] as string, next[index] as string];
      return next;
    });
  const available = [...(shops.data ?? new Map<string, string>())].filter(
    ([id]) => !featured.includes(id),
  );
  return (
    <div className="grid-2">
      <Card title={t("homepage.hero")}>
        <TextField
          label={t("homepage.heroEn")}
          value={en}
          maxLength={200}
          onChange={(e) => setEn(e.target.value)}
          data-testid="hero-en"
        />
        <TextField
          label={t("homepage.heroAr")}
          hint={t("common.arabicReview")}
          dir="rtl"
          lang="ar"
          value={ar}
          maxLength={200}
          onChange={(e) => setAr(e.target.value)}
        />
      </Card>
      <Card title={t("homepage.featured")}>
        <p className="muted small">{t("homepage.featuredHint")}</p>
        {featured.length === 0 ? <p className="muted">{t("homepage.noneFeatured")}</p> : null}
        <ol className="featured-list" data-testid="featured-list">
          {featured.map((id, i) => (
            <li key={id}>
              <span>
                {i + 1}. {nameOf(id)}
              </span>
              <span className="row">
                <Button variant="ghost" aria-label={t("homepage.up")} onClick={() => move(i, -1)}>
                  ↑
                </Button>
                <Button variant="ghost" aria-label={t("homepage.down")} onClick={() => move(i, 1)}>
                  ↓
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => setFeatured((list) => list.filter((x) => x !== id))}
                >
                  {t("common.remove")}
                </Button>
              </span>
            </li>
          ))}
        </ol>
        <div className="row" style={{ alignItems: "end" }}>
          <SelectField
            label={t("homepage.addShop")}
            value={pick}
            onChange={(e) => setPick(e.target.value)}
            data-testid="featured-pick"
            options={[
              { value: "", label: shops.loading ? t("common.loading") : t("homepage.choose") },
              ...available.map(([id, name]) => ({ value: id, label: name })),
            ]}
          />
          <Button
            variant="secondary"
            disabled={!pick || featured.length >= 12}
            onClick={() => {
              setFeatured((list) => [...list, pick]);
              setPick("");
            }}
            data-testid="featured-add"
          >
            {t("homepage.add")}
          </Button>
        </div>
        <ActionError error={shops.error} />
      </Card>
      <Card title={t("homepage.publish")}>
        <TextField
          label={t("common.reason")}
          value={reason}
          maxLength={500}
          onChange={(e) => setReason(e.target.value)}
          data-testid="homepage-reason"
        />
        <Button
          loading={save.pending}
          disabled={reason.trim().length < 3}
          onClick={() => void save.run()}
          data-testid="homepage-save"
        >
          {t("homepage.publishButton")}
        </Button>
        <ActionError error={save.error} />
        <h3>{t("homepage.preview")}</h3>
        <QueryView query={preview}>
          {(h) => (
            <div data-testid="homepage-preview">
              {h.hero ? <Banner tone="info">{h.hero.en}</Banner> : <p className="muted">—</p>}
              <ol>
                {h.featured.map((f) => (
                  <li key={f.merchantId}>
                    {f.brandName}{" "}
                    <span className="muted small">
                      {t("homepage.branches", { count: f.branchCount })}
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </QueryView>
      </Card>
    </div>
  );
}
