import { randomUUID } from "node:crypto";
import {
  cartRequiredResponseSchema,
  checkoutResponseSchema,
  errorResponseSchema,
  payoutResponseSchema,
  publicSlotsResponseSchema,
  quoteResponseSchema,
  reconciliationRunResponseSchema,
  refundResponseSchema,
  trialBalanceResponseSchema,
} from "@beans/contracts";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LedgerService } from "../src/finance/ledger.service.js";
import type { AdminRoleName } from "../src/generated/prisma/client.js";
import { PaymentReconciler } from "../src/ordering/payment-reconciler.service.js";
import { FakePaymentProvider } from "../src/payments/fake-payment.provider.js";
import { dubaiDate, MerchantWorld } from "./merchant-world.js";

const allWeek = [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({
  weekday,
  opens: new Date("1970-01-01T00:00:00Z"),
  closes: new Date("1970-01-01T23:59:00Z"),
}));

describe("phase 7: webhooks, ledger, refunds, reconciliation and payouts (sandbox)", () => {
  let world: MerchantWorld;
  let provider: FakePaymentProvider;
  let ledger: LedgerService;
  let reconciler: PaymentReconciler;
  let maker: { userId: string; token: string };
  let maker2: { userId: string; token: string };
  let checker: { userId: string; token: string };
  /** Holds both finance roles: must still not approve what they requested. */
  let both: { userId: string; token: string };

  const http = () => request(world.app.getHttpServer());
  const errorOf = (body: unknown) => errorResponseSchema.parse(body).error;

  async function admin(roles: AdminRoleName[], aal: "aal1" | "aal2" = "aal2") {
    const user = await world.prisma.user.create({ data: { authSubject: `adm-${randomUUID()}` } });
    for (const role of roles)
      await world.prisma.adminRole.create({ data: { userId: user.id, role } });
    return { userId: user.id, token: await world.issuer.token({ sub: user.authSubject, aal }) };
  }

  function post(path: string, token: string, body: object, key: string | null = randomUUID()) {
    const req = http().post(path).set("Authorization", `Bearer ${token}`);
    if (key) req.set("Idempotency-Key", key);
    return req.send(body);
  }
  const get = (path: string, token: string) =>
    http().get(path).set("Authorization", `Bearer ${token}`);

  async function shop() {
    const merchant = await world.prisma.merchant.create({
      data: {
        legalName: "Finance LLC",
        brandName: `Finance ${randomUUID().slice(0, 6)}`,
        licenseNumber: `FIN-${randomUUID().slice(0, 12)}`,
        status: "approved",
      },
    });
    const branch = await world.prisma.branch.create({
      data: {
        merchantId: merchant.id,
        nameEn: "Finance Corniche",
        address: "Test",
        city: "abu_dhabi",
        modes: ["in_store"],
        capacity: 50,
        status: "active",
        hours: { create: allWeek },
      },
    });
    const category = await world.prisma.category.create({
      data: { merchantId: merchant.id, nameEn: "Bakery" },
    });
    const croissant = await world.prisma.product.create({
      data: {
        merchantId: merchant.id,
        categoryId: category.id,
        names: { en: "Croissant" },
        baseFils: 1200n,
        status: "published",
      },
    });
    return { merchant, branch, croissant };
  }

  /** A customer order of `quantity` croissants (1200 fils each) with the given payment outcome. */
  async function order(
    s: Awaited<ReturnType<typeof shop>>,
    quantity = 2,
    sandboxOutcome: "succeed" | "fail" | "pending" = "succeed",
  ) {
    const person = await world.person();
    const cart = cartRequiredResponseSchema.parse(
      (await world.put("/v1/cart", person.token, { branchId: s.branch.id }).expect(200)).body,
    ).data;
    const filled = cartRequiredResponseSchema.parse(
      (
        await world
          .post("/v1/cart/items", person.token, {
            productId: s.croissant.id,
            quantity,
            expectedVersion: cart.version,
          })
          .expect(201)
      ).body,
    ).data;
    const slots = publicSlotsResponseSchema.parse(
      (
        await http()
          .get(`/v1/branches/${s.branch.id}/slots?date=${dubaiDate(1)}&mode=in_store`)
          .expect(200)
      ).body,
    ).data.slots;
    const quote = quoteResponseSchema.parse(
      (
        await world
          .post("/v1/quotes", person.token, {
            cartId: filled.id,
            cartVersion: filled.version,
            mode: "in_store",
            slotId: slots[0]?.id,
          })
          .expect(201)
      ).body,
    ).data;
    const result = checkoutResponseSchema.parse(
      (await post("/v1/checkout", person.token, { quoteId: quote.id, sandboxOutcome }).expect(201))
        .body,
    ).data;
    const payment = await world.prisma.payment.findFirstOrThrow({
      where: { orderId: result.orderId },
      orderBy: { attempt: "desc" },
    });
    return { person, quote, result, payment };
  }

  /**
   * Walks an order through the staff steps to completed (the database only allows the state
   * machine's steps) and posts the completion journal, as the phase 8 handoff does.
   */
  async function complete(orderId: string) {
    await world.prisma.$transaction(async (tx) => {
      for (const status of ["accepted", "preparing", "ready", "completed"] as const) {
        await tx.order.update({
          where: { id: orderId },
          data: { status, version: { increment: 1 } },
        });
      }
      await ledger.postCompletion(tx, orderId);
    });
  }

  const journalFor = (sourceId: string) =>
    world.prisma.journalTransaction.findMany({
      where: { sourceId },
      include: { lines: { orderBy: { accountCode: "asc" } } },
      orderBy: { createdAt: "asc" },
    });
  const lineView = (lines: { accountCode: string; debitFils: bigint; creditFils: bigint }[]) =>
    lines.map((l) => [l.accountCode, l.debitFils, l.creditFils]);

  beforeAll(async () => {
    world = await MerchantWorld.create();
    provider = world.app.get(FakePaymentProvider);
    ledger = world.app.get(LedgerService);
    reconciler = world.app.get(PaymentReconciler);
    maker = await admin(["finance_maker"]);
    maker2 = await admin(["finance_maker"]);
    checker = await admin(["finance_checker"]);
    both = await admin(["finance_maker", "finance_checker"]);
    // Sandbox commission policy (10%, unapproved), as seeded for development.
    await world.prisma.policy.upsert({
      where: { type_version: { type: "commission", version: "sandbox-v1" } },
      create: {
        type: "commission",
        version: "sandbox-v1",
        effectiveAt: new Date("2026-01-01T00:00:00Z"),
        configuration: { sandbox: true, rateBasisPoints: 1000 },
      },
      update: {},
    });
  });
  afterAll(() => world.close());

  describe("access", () => {
    it("needs a finance role with MFA", async () => {
      const ops = await admin(["operations"]);
      await get("/v1/admin/payments", ops.token).expect(403);
      const noMfa = await admin(["finance_maker"], "aal1");
      const res = await get("/v1/admin/payments", noMfa.token).expect(403);
      expect(errorOf(res.body).code).toBe("MFA_REQUIRED");
      await get("/v1/admin/payments", (await world.person()).token).expect(403);
      await get("/v1/admin/payments", maker.token).expect(200);
      // A maker cannot reach checker routes at all.
      await post(`/v1/admin/refunds/${randomUUID()}/approve`, maker.token, {
        reason: "Checked",
      }).expect(403);
      // A checker cannot request refunds.
      await post("/v1/admin/refunds", checker.token, {
        paymentId: randomUUID(),
        amountFils: "1",
        reason: "test",
      }).expect(403);
    });
  });

  describe("webhooks (Q07)", () => {
    it("refuses forged, altered and stale webhooks without storing anything", async () => {
      const s = await shop();
      const { payment } = await order(s, 1, "pending");
      const ref = payment.providerRef ?? "";
      const send = (hook: { body: string; headers: Record<string, string> }, path = "fake") =>
        http().post(`/v1/webhooks/payments/${path}`).set(hook.headers).send(hook.body);

      const good = provider.webhook("payment", "payment.captured", ref);
      const forged = {
        ...good,
        headers: {
          ...good.headers,
          "sandbox-signature": `t=${Math.floor(Date.now() / 1000)},v1=${"0".repeat(64)}`,
        },
      };
      expect(errorOf((await send(forged).expect(401)).body).code).toBe("UNAUTHENTICATED");
      await send({ body: good.body.replace(ref, "fake_pay_other"), headers: good.headers }).expect(
        401,
      );
      await send(
        provider.webhook("payment", "payment.captured", ref, {
          at: new Date(Date.now() - 600_000),
        }),
      ).expect(401);
      await send({ body: good.body, headers: { "content-type": "application/json" } }).expect(401);
      await send(good, "other-provider").expect(404);
      expect(await world.prisma.paymentWebhookEvent.count({ where: { providerRef: ref } })).toBe(0);
    });

    it("applies the provider's current state once, whatever the order or repetition", async () => {
      const s = await shop();
      const { payment, result } = await order(s, 1, "pending");
      const ref = payment.providerRef ?? "";
      const send = (hook: { body: string; headers: Record<string, string> }) =>
        http().post("/v1/webhooks/payments/fake").set(hook.headers).send(hook.body).expect(200);

      provider.settle(ref, "captured");
      const hook = provider.webhook("payment", "payment.captured", ref, {
        eventId: `evt_${randomUUID()}`,
      });
      expect((await send(hook)).body.data).toEqual({ received: true, duplicate: false });
      expect((await send(hook)).body.data).toEqual({ received: true, duplicate: true });
      // The same change announced again under a new ID, and a stale "failed" event.
      await send(provider.webhook("payment", "payment.captured", ref));
      await send(provider.webhook("payment", "payment.failed", ref));

      const orderRow = await world.prisma.order.findUniqueOrThrow({
        where: { id: result.orderId },
      });
      expect(orderRow.status).toBe("received");
      expect(
        (await world.prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })).status,
      ).toBe("captured");
      const journals = await journalFor(payment.id);
      expect(journals).toHaveLength(1);
      expect(lineView(journals[0]?.lines ?? [])).toEqual([
        ["customer_order_liability", 0n, 1200n],
        ["provider_clearing", 1200n, 0n],
      ]);
      const receipts = await world.prisma.paymentWebhookEvent.findMany({
        where: { providerRef: ref },
      });
      expect(receipts).toHaveLength(3);
      expect(receipts.every((r) => r.status === "processed")).toBe(true);
      expect(receipts.every((r) => /^[0-9a-f]{64}$/.test(r.payloadSha256))).toBe(true);

      // Unknown objects are acknowledged and ignored.
      await send(provider.webhook("payment", "payment.captured", "fake_pay_unknown"));
      expect(
        (
          await world.prisma.paymentWebhookEvent.findFirstOrThrow({
            where: { providerRef: "fake_pay_unknown" },
            orderBy: { receivedAt: "desc" },
          })
        ).status,
      ).toBe("ignored");
    });
  });

  describe("late capture (Q08)", () => {
    it("refunds a payment captured after its hold expired and keeps the ledger at zero", async () => {
      const s = await shop();
      const { payment, result } = await order(s, 2, "pending");
      const orderRow = await world.prisma.order.findUniqueOrThrow({
        where: { id: result.orderId },
      });
      await world.prisma.reservation.update({
        where: { id: orderRow.reservationId },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      await reconciler.sweep();
      provider.settle(payment.providerRef ?? "", "captured");
      const hook = provider.webhook("payment", "payment.captured", payment.providerRef ?? "");
      await http().post("/v1/webhooks/payments/fake").set(hook.headers).send(hook.body).expect(200);

      expect(
        (await world.prisma.order.findUniqueOrThrow({ where: { id: result.orderId } })).status,
      ).toBe("payment_failed");
      const refund = await world.prisma.refund.findFirstOrThrow({
        where: { paymentId: payment.id },
      });
      expect(refund).toMatchObject({
        kind: "late_capture",
        status: "succeeded",
        amountFils: 2400n,
      });
      expect(lineView((await journalFor(refund.id))[0]?.lines ?? [])).toEqual([
        ["customer_order_liability", 2400n, 0n],
        ["provider_clearing", 0n, 2400n],
      ]);
      expect(
        await world.prisma.outboxMessage.count({
          where: { dedupeKey: `refund:${refund.id}:customer_notice` },
        }),
      ).toBe(1);
    });
  });

  describe("refunds with dual control (Q13)", () => {
    it("never refunds more than captured, even under concurrency, and needs a second person", async () => {
      const s = await shop();
      const { payment } = await order(s, 2); // 2400 fils captured
      const ask = (who: { token: string }, amountFils: string, key?: string) =>
        post(
          "/v1/admin/refunds",
          who.token,
          { paymentId: payment.id, amountFils, reason: "Customer complaint" },
          key,
        );

      const raced = await Promise.all([ask(maker, "1500"), ask(maker2, "1500")]);
      expect(raced.map((r) => r.status).sort()).toEqual([201, 409]);
      expect(errorOf(raced.find((r) => r.status === 409)?.body).code).toBe("REFUND_LIMIT");
      const first = refundResponseSchema.parse(raced.find((r) => r.status === 201)?.body).data;
      expect(first).toMatchObject({ status: "requested", amountFils: "1500", kind: "manual" });

      await post(`/v1/admin/refunds/${first.id}/approve`, checker.token, {}).expect(400);
      const approved = refundResponseSchema.parse(
        (
          await post(`/v1/admin/refunds/${first.id}/approve`, checker.token, {
            reason: "Checked receipt",
          }).expect(200)
        ).body,
      ).data;
      expect(approved).toMatchObject({ status: "succeeded", decidedBy: checker.userId });
      await post(`/v1/admin/refunds/${first.id}/approve`, checker.token, {
        reason: "again",
      }).expect(409);
      expect(lineView((await journalFor(first.id))[0]?.lines ?? [])).toEqual([
        ["customer_order_liability", 1500n, 0n],
        ["provider_clearing", 0n, 1500n],
      ]);

      // Self-approval is refused even for someone holding both roles.
      const own = refundResponseSchema.parse((await ask(both, "500").expect(201)).body).data;
      const self = await post(`/v1/admin/refunds/${own.id}/approve`, both.token, {
        reason: "My own",
      }).expect(403);
      expect(errorOf(self.body).message).toMatch(/someone other/);
      await ask(maker, "401").expect(409); // 1500 + 500 + 401 > 2400
      await post(`/v1/admin/refunds/${own.id}/reject`, checker.token, {
        reason: "Duplicate",
      }).expect(200);

      // A failed provider refund frees the amount and posts nothing.
      provider.nextRefundOutcome = "fail";
      const failing = refundResponseSchema.parse((await ask(maker, "900").expect(201)).body).data;
      const failed = refundResponseSchema.parse(
        (
          await post(`/v1/admin/refunds/${failing.id}/approve`, both.token, {
            reason: "Checked",
          }).expect(200)
        ).body,
      ).data;
      provider.nextRefundOutcome = "succeed";
      expect(failed).toMatchObject({ status: "failed", failureCode: "sandbox_refund_failed" });
      expect(await journalFor(failing.id)).toHaveLength(0);

      // Replay of a request returns the same refund, not a second one.
      const key = randomUUID();
      const once = (await ask(maker, "900", key).expect(201)).body;
      const twice = await ask(maker, "900", key).expect(201);
      expect(twice.body).toEqual(once);
      expect(twice.headers["idempotent-replayed"]).toBe("true");
      await ask(maker, "1").expect(409); // 1500 + 900 = 2400

      // The database itself refuses an over-limit refund written around the service.
      await expect(
        world.prisma.refund.create({
          data: {
            paymentId: payment.id,
            orderId: payment.orderId,
            kind: "late_capture",
            amountFils: 1n,
            currency: "AED",
            reason: "bypass",
            status: "approved",
            providerKey: `refund:${randomUUID()}`,
          },
        }),
      ).rejects.toThrow(/refund_limit/);

      const audit = await world.prisma.auditEvent.findMany({
        where: { targetId: first.id },
        orderBy: { createdAt: "asc" },
      });
      expect(audit.map((a) => a.action)).toEqual(["refund.requested", "refund.approved"]);
      await post("/v1/admin/refunds", maker.token, {
        paymentId: randomUUID(),
        amountFils: "1",
        reason: "nope",
      }).expect(404);
    });
  });

  describe("payouts and reconciliation (Q14)", () => {
    it("pays out available earnings once, with a different approver, after refunds", async () => {
      const s = await shop();
      const a = await order(s, 2); // 2400
      await complete(a.result.orderId);
      expect(lineView((await journalFor(a.result.orderId))[0]?.lines ?? [])).toEqual([
        ["customer_order_liability", 2400n, 0n],
        ["merchant_payable", 0n, 2160n],
        ["platform_commission_revenue", 0n, 240n],
      ]);
      // A refund after completion reverses payable and commission in proportion.
      const refund = refundResponseSchema.parse(
        (
          await post("/v1/admin/refunds", maker.token, {
            paymentId: a.payment.id,
            amountFils: "600",
            reason: "Cold coffee",
          }).expect(201)
        ).body,
      ).data;
      await post(`/v1/admin/refunds/${refund.id}/approve`, checker.token, {
        reason: "Checked",
      }).expect(200);
      expect(lineView((await journalFor(refund.id))[0]?.lines ?? [])).toEqual([
        ["merchant_payable", 540n, 0n],
        ["platform_commission_revenue", 60n, 0n],
        ["provider_clearing", 0n, 600n],
      ]);

      const periodEnd = new Date().toISOString();
      const draft = (who: { token: string }) =>
        post("/v1/admin/payouts", who.token, { merchantId: s.merchant.id, periodEnd });
      const drafts = await Promise.all([draft(maker), draft(maker2)]);
      expect(drafts.map((d) => d.status).sort()).toEqual([201, 422]);
      const payout = payoutResponseSchema.parse(drafts.find((d) => d.status === 201)?.body).data;
      expect(payout).toMatchObject({ status: "pending_approval", amountFils: "1620" });

      await post(`/v1/admin/payouts/${payout.id}/approve`, maker.token, {
        reason: "Checked",
      }).expect(403);
      const paid = payoutResponseSchema.parse(
        (
          await post(`/v1/admin/payouts/${payout.id}/approve`, checker.token, {
            reason: "Weekly run",
          }).expect(200)
        ).body,
      ).data;
      expect(paid).toMatchObject({ status: "paid", checkerId: checker.userId });
      expect(lineView((await journalFor(payout.id))[0]?.lines ?? [])).toEqual([
        ["merchant_payable", 1620n, 0n],
        ["provider_clearing", 0n, 1620n],
      ]);
      await draft(maker).expect(422);

      // A failed payout releases its earnings for the next one.
      const b = await order(s, 1); // 1200 → payable 1080
      await complete(b.result.orderId);
      provider.nextPayoutOutcome = "fail";
      const second = payoutResponseSchema.parse(
        (
          await post("/v1/admin/payouts", maker.token, {
            merchantId: s.merchant.id,
            periodEnd: new Date().toISOString(),
          }).expect(201)
        ).body,
      ).data;
      expect(second.amountFils).toBe("1080");
      const failed = payoutResponseSchema.parse(
        (
          await post(`/v1/admin/payouts/${second.id}/approve`, both.token, {
            reason: "Checked",
          }).expect(200)
        ).body,
      ).data;
      provider.nextPayoutOutcome = "succeed";
      expect(failed.status).toBe("failed");
      expect(await journalFor(second.id)).toHaveLength(0);
      const third = payoutResponseSchema.parse(
        (
          await post("/v1/admin/payouts", maker.token, {
            merchantId: s.merchant.id,
            periodEnd: new Date().toISOString(),
          }).expect(201)
        ).body,
      ).data;
      expect(third.amountFils).toBe("1080");
      await post(`/v1/admin/payouts/${third.id}/reject`, checker.token, { reason: "Hold" }).expect(
        200,
      );
      await post(`/v1/admin/payouts/${third.id}/approve`, checker.token, {
        reason: "Checked",
      }).expect(409);
    });

    it("turns statement differences into exceptions that block payouts until resolved", async () => {
      const from = new Date(Date.now() - 1000);
      const s = await shop();
      const a = await order(s, 2);
      await complete(a.result.orderId);
      const run = (to = new Date(Date.now() + 1000)) =>
        post(
          "/v1/admin/reconciliation/runs",
          maker.token,
          { from: from.toISOString(), to: to.toISOString() },
          null,
        );

      const clean = reconciliationRunResponseSchema.parse((await run().expect(201)).body).data;
      expect(clean).toMatchObject({ mismatched: 0, exceptionIds: [] });
      expect(clean.matched).toBeGreaterThanOrEqual(1);

      provider.tamper(a.payment.providerRef ?? "", { amountFils: 2300n });
      const dirty = reconciliationRunResponseSchema.parse((await run().expect(201)).body).data;
      expect(dirty.mismatched).toBe(1);
      const list = await get(
        `/v1/admin/reconciliation?status=open&merchantId=${s.merchant.id}`,
        checker.token,
      ).expect(200);
      expect(list.body.data).toHaveLength(1);
      expect(list.body.data[0]).toMatchObject({
        kind: "amount_mismatch",
        objectType: "payment",
        localId: a.payment.id,
        expected: { amountFils: "2400" },
        actual: { amountFils: "2300" },
      });

      const blocked = await post("/v1/admin/payouts", maker.token, {
        merchantId: s.merchant.id,
        periodEnd: new Date().toISOString(),
      }).expect(409);
      expect(errorOf(blocked.body).message).toMatch(/reconciliation/i);

      const exceptionId = dirty.exceptionIds[0] ?? "";
      await post(
        `/v1/admin/reconciliation/${exceptionId}/resolve`,
        maker.token,
        { reason: "Checked" },
        null,
      ).expect(403);
      const resolved = await post(
        `/v1/admin/reconciliation/${exceptionId}/resolve`,
        checker.token,
        { reason: "Provider statement corrected" },
        null,
      ).expect(200);
      expect(resolved.body.data).toMatchObject({ status: "resolved" });
      await post(
        `/v1/admin/reconciliation/${exceptionId}/resolve`,
        checker.token,
        { reason: "again" },
        null,
      ).expect(409);
      await post("/v1/admin/payouts", maker.token, {
        merchantId: s.merchant.id,
        periodEnd: new Date().toISOString(),
      }).expect(201);
    });
  });

  describe("journal invariants (Q23)", () => {
    it("keeps every posting balanced, append-only and posted once", async () => {
      const tb = trialBalanceResponseSchema.parse(
        (await get("/v1/admin/ledger/trial-balance", checker.token).expect(200)).body,
      ).data;
      expect(tb).toMatchObject({ balanced: true, unbalancedJournals: 0 });
      expect(tb.totalDebitFils).toBe(tb.totalCreditFils);

      // An unbalanced posting written around the service fails at commit.
      await expect(
        world.prisma.$transaction(async (tx) => {
          const j = await tx.journalTransaction.create({
            data: { sourceType: "payment", sourceId: randomUUID(), eventType: "captured" },
          });
          await tx.journalLine.create({
            data: { journalId: j.id, accountCode: "provider_clearing", debitFils: 100n },
          });
          await tx.journalLine.create({
            data: { journalId: j.id, accountCode: "customer_order_liability", creditFils: 99n },
          });
        }),
      ).rejects.toThrow(/unbalanced/);
      await expect(
        world.prisma.journalLine.create({
          data: {
            journalId: (await world.prisma.journalTransaction.findFirstOrThrow()).id,
            accountCode: "provider_clearing",
            debitFils: 1n,
            creditFils: 1n,
          },
        }),
      ).rejects.toThrow();
      await expect(
        world.prisma.journalLine.updateMany({
          data: { debitFils: 0n },
          where: { debitFils: { gt: 0n } },
        }),
      ).rejects.toThrow(/append-only/);

      // Posting the same event twice records it once.
      const s = await shop();
      const { payment } = await order(s, 1);
      const again = await world.prisma.$transaction((tx) => ledger.postCapture(tx, payment));
      expect(again).toBe(false);
      expect(await journalFor(payment.id)).toHaveLength(1);

      // Totals reconcile for one merchant: clearing = captured - refunded - paid out.
      const cap = await order(s, 2);
      await complete(cap.result.orderId);
      const r = refundResponseSchema.parse(
        (
          await post("/v1/admin/refunds", maker.token, {
            paymentId: cap.payment.id,
            amountFils: "300",
            reason: "Partial",
          }).expect(201)
        ).body,
      ).data;
      await post(`/v1/admin/refunds/${r.id}/approve`, checker.token, { reason: "Checked" }).expect(
        200,
      );
      const p = payoutResponseSchema.parse(
        (
          await post("/v1/admin/payouts", maker.token, {
            merchantId: s.merchant.id,
            periodEnd: new Date().toISOString(),
          }).expect(201)
        ).body,
      ).data;
      await post(`/v1/admin/payouts/${p.id}/approve`, checker.token, { reason: "Checked" }).expect(
        200,
      );
      const sources = [payment.id, cap.payment.id, r.id, p.id, cap.result.orderId];
      const lines = await world.prisma.journalLine.findMany({
        where: { journal: { sourceId: { in: sources } } },
      });
      const net = (account: string) =>
        lines
          .filter((l) => l.accountCode === account)
          .reduce((sum, l) => sum + l.debitFils - l.creditFils, 0n);
      // Captured 1200 + 2400, refunded 300, paid out (2400 - 240) - (300 - 30) = 1890.
      expect(p.amountFils).toBe("1890");
      expect(net("provider_clearing")).toBe(1200n + 2400n - 300n - 1890n);
      expect(net("merchant_payable")).toBe(0n);
      expect(net("platform_commission_revenue")).toBe(-(240n - 30n));
      expect(net("customer_order_liability")).toBe(-1200n); // the uncompleted order
      expect(lines.reduce((sum, l) => sum + l.debitFils - l.creditFils, 0n)).toBe(0n);
    });
  });
});
