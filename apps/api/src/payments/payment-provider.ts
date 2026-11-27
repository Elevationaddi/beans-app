/**
 * Payment provider adapter (docs/08: createPayment, fetchPayment, refund, fetchRefund,
 * initiatePayout, fetchPayout, verifyWebhook) plus a settlement statement for daily
 * reconciliation. Only a sandbox implementation exists, and the server refuses to start it
 * in production (see config/env.ts). Amounts are integer fils; no card data ever passes here.
 */

export type ProviderPaymentStatus = "pending" | "captured" | "failed";
export type ProviderRefundStatus = "pending" | "succeeded" | "failed";
export type ProviderPayoutStatus = "pending" | "paid" | "failed";

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

export interface RefundInput {
  /** Stable per refund (`refund:<refundId>`). */
  idempotencyKey: string;
  paymentRef: string;
  amountFils: bigint;
  currency: "AED";
}

export interface ProviderRefund {
  providerRef: string;
  paymentRef: string;
  status: ProviderRefundStatus;
  amountFils: bigint;
  currency: string;
  failureCode?: string;
}

export interface PayoutInput {
  /** Stable per payout (`payout:<payoutId>`). */
  idempotencyKey: string;
  merchantId: string;
  amountFils: bigint;
  currency: "AED";
}

export interface ProviderPayout {
  providerRef: string;
  status: ProviderPayoutStatus;
  amountFils: bigint;
  currency: string;
  failureCode?: string;
}

/** A verified webhook. Handlers re-fetch the object; the event only says what to look at. */
export interface WebhookEvent {
  eventId: string;
  type: string;
  objectType: "payment" | "refund" | "payout";
  providerRef: string;
  createdAt: Date;
}

export interface StatementEntry {
  objectType: "payment" | "refund" | "payout";
  providerRef: string;
  status: string;
  amountFils: bigint;
  currency: string;
  createdAt: Date;
}

export class WebhookVerificationError extends Error {}

export interface PaymentProvider {
  readonly name: string;
  createPayment(input: CreatePaymentInput): Promise<ProviderPayment>;
  /** Current state at the provider; null when the provider has no such payment. */
  fetchPayment(providerRef: string): Promise<ProviderPayment | null>;
  /** Looks a payment up by our idempotency key (after a lost response). */
  findByKey(idempotencyKey: string): Promise<ProviderPayment | null>;
  refund(input: RefundInput): Promise<ProviderRefund>;
  fetchRefund(providerRef: string): Promise<ProviderRefund | null>;
  initiatePayout(input: PayoutInput): Promise<ProviderPayout>;
  fetchPayout(providerRef: string): Promise<ProviderPayout | null>;
  /**
   * Verifies the signature over the exact raw body and the replay window, then parses it.
   * Throws WebhookVerificationError for anything forged, stale or malformed.
   */
  verifyWebhook(
    rawBody: Buffer,
    headers: Record<string, string | string[] | undefined>,
    now?: Date,
  ): WebhookEvent;
  /** Everything the provider recorded in [from, to), for reconciliation. */
  statement(from: Date, to: Date): Promise<StatementEntry[]>;
}

export const PAYMENT_PROVIDER = Symbol("PAYMENT_PROVIDER");
export const WEBHOOK_SECRET = Symbol("PAYMENT_WEBHOOK_SECRET");
