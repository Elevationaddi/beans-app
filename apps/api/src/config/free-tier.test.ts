import { readFileSync } from "node:fs";
import { MAX_DOCUMENT_BYTES } from "@beans/contracts";
import { describe, expect, it } from "vitest";

/**
 * Guards for the approved free and existing plans (cost policy, 2026-11-28). These numbers come
 * from the providers' published limits checked on 2026-11-28; if a limit changes, update the
 * free-tier register (docs/22) together with this test.
 */
const LIMITS = {
  vercel: { maxDurationSeconds: 300, cronsPerProject: 100, requestBodyBytes: 4.5 * 1024 * 1024 },
  supabaseFree: { fileUploadBytes: 50 * 1024 * 1024 },
};

const vercel = (app: string) =>
  JSON.parse(readFileSync(new URL(`../../../${app}/vercel.json`, import.meta.url), "utf8")) as {
    regions?: string[];
    functions?: Record<string, { maxDuration?: number }>;
    crons?: { path: string; schedule: string }[];
  };

describe("free-tier fit", () => {
  it("keeps the API function and cron inside Vercel's limits", () => {
    const api = vercel("api");
    for (const fn of Object.values(api.functions ?? {})) {
      expect(fn.maxDuration ?? 0).toBeLessThanOrEqual(LIMITS.vercel.maxDurationSeconds);
    }
    expect(api.crons?.length ?? 0).toBeLessThanOrEqual(LIMITS.vercel.cronsPerProject);
    expect(api.crons).toEqual([{ path: "/v1/internal/cron/tick", schedule: "* * * * *" }]);
  });

  it("pins every Vercel project to one region next to the database (Mumbai)", () => {
    for (const app of ["api", "merchant", "admin"]) {
      expect(vercel(app).regions).toEqual(["bom1"]);
    }
  });

  it("keeps document uploads under Supabase Free's file limit and off Vercel's body limit", () => {
    expect(MAX_DOCUMENT_BYTES).toBeLessThanOrEqual(LIMITS.supabaseFree.fileUploadBytes);
    // Larger than a Vercel request body: that is why uploads go straight to Supabase Storage.
    expect(MAX_DOCUMENT_BYTES).toBeGreaterThan(LIMITS.vercel.requestBodyBytes);
  });
});
