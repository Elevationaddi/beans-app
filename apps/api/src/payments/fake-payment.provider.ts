import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import {
  type CreatePaymentInput,
  type PaymentProvider,
  type PayoutInput,
  type ProviderPayment,
  type ProviderPaymentStatus,
  type ProviderPayout,
  type ProviderRefund,
  type RefundInput,
  type SandboxOutcome,
  type StatementEntry,
  WEBHOOK_SECRET,
  type WebhookEvent,
  WebhookVerificationError,
} from "./payment-provider.js";

/** Signature header of the sandbox provider: `t=<unix seconds>,v1=<hex HMAC-SHA256>`. */
export const SANDBOX_SIGNATURE_HEADER = "sandbox-signature";
/** Webhooks older or newer than this are refused (replay window). */
export const WEBHOOK_TOLERANCE_SECONDS = 300;

interface Stamped<T> {
  value: T;
  key: string;
  createdAt: Date;
}

const statusFor = (outcome: SandboxOutcome) =>
  outcome === "succeed" ? "ok" : outcome === "fail" ? "failed" : "pending";

/**
 * Sandbox payment provider. No money moves and nothing leaves the process. It behaves like a
 * real provider in the ways the platform depends on: one object per idempotency key, pending
 * objects that settle later, refunds limited to what was captured, signed webhooks and a
 * statement for reconciliation. State lives in memory and resets with the process.
 *
 * Refused in production by config/env.ts; there is no hard-coded success in production code.
 */
@Injectable()
export class FakePaymentProvider implements PaymentProvider {
  readonly name = "fake";
  private readonly payments = new Map<string, Stamped<ProviderPayment>>();
  private readonly refunds = new Map<string, Stamped<ProviderRefund>>();
  private readonly payouts = new Map<string, Stamped<ProviderPayout>>();
  private readonly byKey = new Map<string, string>();
  /** Number of payments created (tests check there is never a double charge). */
  chargesCreated = 0;
  /** Sandbox controls: how the next refund and payout are answered. */
  nextRefundOutcome: SandboxOutcome = "succeed";
  nextPayoutOutcome: SandboxOutcome = "succeed";

  constructor(@Inject(WEBHOOK_SECRET) private readonly secret: string) {}

  // ── Payments ──────────────────────────────────────────────────────────────

  async createPayment(input: CreatePaymentInput): Promise<ProviderPayment> {
    const existing = this.lookup(this.payments, input.idempotencyKey);
    if (existing) {
      if (existing.amountFils !== input.amountFils) {
        throw new Error("fake provider: idempotency key reused with a different amount");
      }
      return { ...existing };
    }
    const outcome = statusFor(input.sandboxOutcome ?? "succeed");
    const status: ProviderPaymentStatus = outcome === "ok" ? "captured" : outcome;
    const payment: ProviderPayment = {
      providerRef: `fake_pay_${randomUUID()}`,
      status,
      amountFils: input.amountFils,
      currency: input.currency,
      ...(status === "failed" && { failureCode: "sandbox_declined" }),
      clientAction: { type: "none" },
    };
    this.store(this.payments, input.idempotencyKey, payment);
    this.chargesCreated += 1;
    return { ...payment };
  }

  async fetchPayment(providerRef: string): Promise<ProviderPayment | null> {
    const found = this.payments.get(providerRef);
    return found ? { ...found.value } : null;
  }

  async findByKey(idempotencyKey: string): Promise<ProviderPayment | null> {
    const found = this.lookup(this.payments, idempotencyKey);
    return found ? { ...found } : null;
  }

  // ── Refunds ───────────────────────────────────────────────────────────────

  async refund(input: RefundInput): Promise<ProviderRefund> {
    const existing = this.lookup(this.refunds, input.idempotencyKey);
    if (existing) return { ...existing };
    const payment = this.payments.get(input.paymentRef)?.value;
    if (!payment || payment.status !== "captured") {
      throw new Error("fake provider: refund of a payment that is not captured");
    }
    const refunded = [...this.refunds.values()]
      .filter((r) => r.value.paymentRef === input.paymentRef && r.value.status !== "failed")
      .reduce((sum, r) => sum + r.value.amountFils, 0n);
    if (refunded + input.amountFils > payment.amountFils) {
      throw new Error("fake provider: refunds would exceed the captured amount");
    }
    const outcome = statusFor(this.nextRefundOutcome);
    const refund: ProviderRefund = {
      providerRef: `fake_ref_${randomUUID()}`,
      paymentRef: input.paymentRef,
      status: outcome === "ok" ? "succeeded" : outcome,
      amountFils: input.amountFils,
      currency: input.currency,
      ...(outcome === "failed" && { failureCode: "sandbox_refund_failed" }),
    };
    this.store(this.refunds, input.idempotencyKey, refund);
    return { ...refund };
  }

  async fetchRefund(providerRef: string): Promise<ProviderRefund | null> {
    const found = this.refunds.get(providerRef);
    return found ? { ...found.value } : null;
  }

  // ── Payouts ───────────────────────────────────────────────────────────────

  async initiatePayout(input: PayoutInput): Promise<ProviderPayout> {
    const existing = this.lookup(this.payouts, input.idempotencyKey);
    if (existing) return { ...existing };
    const outcome = statusFor(this.nextPayoutOutcome);
    const payout: ProviderPayout = {
      providerRef: `fake_po_${randomUUID()}`,
      status: outcome === "ok" ? "paid" : outcome,
      amountFils: input.amountFils,
      currency: input.currency,
      ...(outcome === "failed" && { failureCode: "sandbox_payout_failed" }),
    };
    this.store(this.payouts, input.idempotencyKey, payout);
    return { ...payout };
  }

  async fetchPayout(providerRef: string): Promise<ProviderPayout | null> {
    const found = this.payouts.get(providerRef);
    return found ? { ...found.value } : null;
  }

  // ── Webhooks and statement ────────────────────────────────────────────────

  verifyWebhook(
    rawBody: Buffer,
    headers: Record<string, string | string[] | undefined>,
    now = new Date(),
  ): WebhookEvent {
    const header = headers[SANDBOX_SIGNATURE_HEADER];
    const value = Array.isArray(header) ? header[0] : header;
    const match = /^t=(\d{1,12}),v1=([0-9a-f]{64})$/.exec(value ?? "");
    if (!match?.[1] || !match[2])
      throw new WebhookVerificationError("missing or malformed signature");
    const timestamp = Number(match[1]);
    const expected = this.sign(timestamp, rawBody);
    const given = Buffer.from(match[2], "hex");
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
      throw new WebhookVerificationError("signature mismatch");
    }
    if (Math.abs(now.getTime() / 1000 - timestamp) > WEBHOOK_TOLERANCE_SECONDS) {
      throw new WebhookVerificationError("outside the replay window");
    }
    let body: unknown;
    try {
      body = JSON.parse(rawBody.toString("utf8"));
    } catch {
      throw new WebhookVerificationError("body is not JSON");
    }
    const event = body as Partial<Record<string, unknown>>;
    const objectType = event["objectType"];
    if (
      typeof event["id"] !== "string" ||
      typeof event["type"] !== "string" ||
      typeof event["providerRef"] !== "string" ||
      (objectType !== "payment" && objectType !== "refund" && objectType !== "payout")
    ) {
      throw new WebhookVerificationError("unexpected event shape");
    }
    return {
      eventId: event["id"],
      type: event["type"],
      objectType,
      providerRef: event["providerRef"],
      createdAt: new Date(timestamp * 1000),
    };
  }

  async statement(from: Date, to: Date): Promise<StatementEntry[]> {
    const inRange = (d: Date) => d >= from && d < to;
    const entries: StatementEntry[] = [];
    for (const p of this.payments.values())
      if (inRange(p.createdAt)) entries.push({ objectType: "payment", ...this.entry(p) });
    for (const r of this.refunds.values())
      if (inRange(r.createdAt)) entries.push({ objectType: "refund", ...this.entry(r) });
    for (const p of this.payouts.values())
      if (inRange(p.createdAt)) entries.push({ objectType: "payout", ...this.entry(p) });
    return entries;
  }

  // ── Sandbox controls (tests and local development only) ───────────────────

  /** Settles a pending payment, refund or payout, as a real provider would later. */
  settle(providerRef: string, status: "captured" | "succeeded" | "paid" | "failed"): void {
    const record =
      this.payments.get(providerRef) ??
      this.refunds.get(providerRef) ??
      this.payouts.get(providerRef);
    if (!record) throw new Error(`fake provider: unknown object ${providerRef}`);
    if (record.value.status !== "pending") {
      throw new Error(`fake provider: ${providerRef} is already ${record.value.status}`);
    }
    record.value = { ...record.value, status } as typeof record.value;
  }

  /** Changes what the provider reports for an object, to simulate a statement mismatch. */
  tamper(providerRef: string, change: { amountFils?: bigint; status?: string }): void {
    const record =
      this.payments.get(providerRef) ??
      this.refunds.get(providerRef) ??
      this.payouts.get(providerRef);
    if (!record) throw new Error(`fake provider: unknown object ${providerRef}`);
    record.value = { ...record.value, ...change } as typeof record.value;
  }

  /** A signed webhook for an object, exactly as the provider would send it. */
  webhook(
    objectType: WebhookEvent["objectType"],
    type: string,
    providerRef: string,
    options: { eventId?: string; at?: Date } = {},
  ): { body: string; headers: Record<string, string> } {
    const timestamp = Math.floor((options.at ?? new Date()).getTime() / 1000);
    const body = JSON.stringify({
      id: options.eventId ?? `evt_${randomUUID()}`,
      type,
      objectType,
      providerRef,
    });
    return {
      body,
      headers: {
        "content-type": "application/json",
        [SANDBOX_SIGNATURE_HEADER]: `t=${timestamp},v1=${this.sign(timestamp, Buffer.from(body)).toString("hex")}`,
      },
    };
  }

  private sign(timestamp: number, rawBody: Buffer): Buffer {
    return createHmac("sha256", this.secret).update(`${timestamp}.`).update(rawBody).digest();
  }

  private entry(
    record: Stamped<{ providerRef: string; status: string; amountFils: bigint; currency: string }>,
  ) {
    return {
      providerRef: record.value.providerRef,
      status: record.value.status,
      amountFils: record.value.amountFils,
      currency: record.value.currency,
      createdAt: record.createdAt,
    };
  }

  private lookup<T>(map: Map<string, Stamped<T>>, key: string): T | undefined {
    const ref = this.byKey.get(key);
    return ref ? map.get(ref)?.value : undefined;
  }

  private store<T extends { providerRef: string }>(
    map: Map<string, Stamped<T>>,
    key: string,
    value: T,
  ): void {
    map.set(value.providerRef, { value, key, createdAt: new Date() });
    this.byKey.set(key, value.providerRef);
  }
}
