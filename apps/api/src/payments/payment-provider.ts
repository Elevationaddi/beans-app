/**
 * Payment provider adapter (docs/08: createPayment, fetchPayment, refund, fetchRefund,
 * initiatePayout, fetchPayout, verifyWebhook). Phase 6 needs the first two; the rest arrive
 * with webhooks, refunds and payouts. Only a sandbox implementation exists, and the server
 * refuses to start it in production (see config/env.ts).
 */

export type ProviderPaymentStatus = "pending" | "captured" | "failed";

/** Sandbox-only instruction for the fake provider. Real providers ignore it. */
export type SandboxOutcome = "succeed" | "fail" | "pending";

export interface CreatePaymentInput {
  /** Stable per attempt (`order:<orderId>:<attempt>`): repeating a call never charges twice. */
  idempotencyKey: string;
  orderId: string;
  amountFils: bigint;
  currency: "AED";
  sandboxOutcome?: SandboxOutcome;
}

export interface ProviderPayment {
  providerRef: string;
  status: ProviderPaymentStatus;
  amountFils: bigint;
  currency: string;
  /** Provider reason code for a failure. Never card data. */
  failureCode?: string;
  /** What the app must do next. The fake provider never needs an action. */
  clientAction: { type: "none" };
}

export interface PaymentProvider {
  readonly name: string;
  createPayment(input: CreatePaymentInput): Promise<ProviderPayment>;
  /** Current state at the provider; null when the provider has no such payment. */
  fetchPayment(providerRef: string): Promise<ProviderPayment | null>;
  /** Looks a payment up by our idempotency key (after a lost response). */
  findByKey(idempotencyKey: string): Promise<ProviderPayment | null>;
}

export const PAYMENT_PROVIDER = Symbol("PAYMENT_PROVIDER");
