import { randomUUID } from "node:crypto";
import { Injectable } from "@nestjs/common";
import type {
  CreatePaymentInput,
  PaymentProvider,
  ProviderPayment,
  ProviderPaymentStatus,
} from "./payment-provider.js";

interface FakeRecord {
  key: string;
  payment: ProviderPayment;
}

/**
 * Sandbox payment provider. No money moves and nothing leaves the process. It behaves like a
 * real provider in the ways checkout depends on: one payment per idempotency key, and a
 * pending payment can settle later. The outcome is chosen per call (sandboxOutcome), default
 * "succeed". State lives in memory, so it resets when the process restarts.
 *
 * Refused in production by config/env.ts; there is no hard-coded success in production code.
 */
@Injectable()
export class FakePaymentProvider implements PaymentProvider {
  readonly name = "fake";
  private readonly byKey = new Map<string, FakeRecord>();
  private readonly byRef = new Map<string, FakeRecord>();
  /** Number of createPayment calls that created a new payment (tests check no double charge). */
  chargesCreated = 0;

  async createPayment(input: CreatePaymentInput): Promise<ProviderPayment> {
    const existing = this.byKey.get(input.idempotencyKey);
    if (existing) {
      if (existing.payment.amountFils !== input.amountFils) {
        throw new Error("fake provider: idempotency key reused with a different amount");
      }
      return { ...existing.payment };
    }
    const outcome = input.sandboxOutcome ?? "succeed";
    const status: ProviderPaymentStatus =
      outcome === "succeed" ? "captured" : outcome === "fail" ? "failed" : "pending";
    const record: FakeRecord = {
      key: input.idempotencyKey,
      payment: {
        providerRef: `fake_${randomUUID()}`,
        status,
        amountFils: input.amountFils,
        currency: input.currency,
        ...(status === "failed" && { failureCode: "sandbox_declined" }),
        clientAction: { type: "none" },
      },
    };
    this.byKey.set(record.key, record);
    this.byRef.set(record.payment.providerRef, record);
    this.chargesCreated += 1;
    return { ...record.payment };
  }

  async fetchPayment(providerRef: string): Promise<ProviderPayment | null> {
    const record = this.byRef.get(providerRef);
    return record ? { ...record.payment } : null;
  }

  async findByKey(idempotencyKey: string): Promise<ProviderPayment | null> {
    const record = this.byKey.get(idempotencyKey);
    return record ? { ...record.payment } : null;
  }

  /** Sandbox control: settle a pending payment, as a real provider would later. */
  settle(providerRef: string, status: "captured" | "failed"): void {
    const record = this.byRef.get(providerRef);
    if (!record) throw new Error(`fake provider: unknown payment ${providerRef}`);
    if (record.payment.status !== "pending") {
      throw new Error(`fake provider: payment ${providerRef} is already ${record.payment.status}`);
    }
    record.payment = {
      ...record.payment,
      status,
      ...(status === "failed" && { failureCode: "sandbox_declined" }),
    };
  }
}
