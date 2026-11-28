import { randomUUID } from "node:crypto";
import { profileResponseSchema } from "@beans/contracts";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { MerchantWorld } from "./merchant-world.js";

/**
 * Cycle 3: behaviour on small serverless connection pools and when a free-tier service is down.
 */
describe("serverless resilience", () => {
  it("serves a burst of requests through a single database connection", async () => {
    // On Vercel each instance keeps a tiny pool (DATABASE_POOL_MAX 1-3) behind Supabase's
    // transaction pooler; requests must queue for the connection, not fail.
    const world = await MerchantWorld.create({ DATABASE_POOL_MAX: "1" });
    try {
      const people = await Promise.all(Array.from({ length: 5 }, () => world.person()));
      const responses = await Promise.all(
        Array.from({ length: 30 }, (_, i) => world.get("/v1/me", people[i % 5]!.token)),
      );
      expect(responses.map((r) => r.status)).toEqual(Array(30).fill(200));
      for (const [i, r] of responses.entries()) {
        expect(profileResponseSchema.parse(r.body).data.id).toBe(people[i % 5]!.user.id);
      }
      const health = await request(world.app.getHttpServer()).get("/health").expect(200);
      expect(health.body.checks).toEqual({ database: "up" });
    } finally {
      await world.close();
    }
  });

  it("answers a clear error when file storage is down, without leaking the server key or hurting ordering", async () => {
    const serviceKey = ["service", "role", "key", "for", "tests"].join("-");
    // Port 1 is never listening, so every storage call is refused.
    const world = await MerchantWorld.create({
      STORAGE_DRIVER: "supabase",
      SUPABASE_URL: "http://127.0.0.1:1",
      SUPABASE_SERVICE_ROLE_KEY: serviceKey,
    });
    try {
      const merchant = await world.prisma.merchant.create({
        data: {
          legalName: `Outage LLC ${randomUUID().slice(0, 6)}`,
          brandName: `Outage ${randomUUID().slice(0, 6)}`,
          licenseNumber: `OUT-${randomUUID().slice(0, 12)}`,
          status: "draft",
        },
      });
      const owner = await world.person({ merchantId: merchant.id, role: "owner" });
      const res = await world.post("/v1/uploads", owner.token, {
        purpose: "merchant_document",
        merchantId: merchant.id,
        documentType: "trade_license",
        mime: "application/pdf",
        size: 1000,
      });
      expect(res.status).toBeGreaterThanOrEqual(500);
      expect(JSON.stringify(res.body)).not.toContain(serviceKey);
      expect(res.body.error.requestId).toBeTruthy();
      // The rest of the API keeps working.
      await request(world.app.getHttpServer()).get("/health").expect(200);
      await world.get("/v1/me", owner.token).expect(200);
    } finally {
      await world.close();
    }
  });
});
