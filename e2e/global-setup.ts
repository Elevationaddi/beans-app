import { call, devToken, BRANCH } from "./api";

/**
 * Keeps the seeded test branch open around the clock so ordering tests do not depend on the
 * time CI runs, and makes sure the platform is not left paused by an earlier run.
 */
export default async function globalSetup() {
  const owner = await devToken("owner-a@example.test");
  const branches = await call<{ id: string; nameEn: string }[]>(
    "GET",
    "/v1/merchant/branches?limit=50",
    owner,
  );
  const branch = branches.find((b) => b.nameEn === BRANCH);
  if (!branch) throw new Error(`Seeded branch ${BRANCH} not found`);
  await call("PATCH", `/v1/merchant/branches/${branch.id}`, owner, {
    hours: [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, opens: "00:00", closes: "23:59" })),
  });
  const ops = await devToken("ops@example.test", true);
  const settings = await call<{ key: string; version: number; value: { ordersPaused: boolean } }[]>(
    "GET",
    "/v1/admin/platform-settings",
    ops,
  );
  const pause = settings.find((s) => s.key === "pause");
  if (pause?.value.ordersPaused) {
    await call("PUT", "/v1/admin/platform-settings/pause", ops, {
      value: { ordersPaused: false, message: null },
      expectedVersion: pause.version,
      reason: "E2E setup: reopen ordering",
    });
  }
}
