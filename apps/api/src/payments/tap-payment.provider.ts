import { createHmac, timingSafeEqual } from "node:crypto";
import {
  type CreatePaymentInput,
  type PaymentProvider,
  type PayoutInput,
  type ProviderPayment,
  type ProviderPaymentStatus,
  type ProviderPayout,
  type ProviderRefund,
  type ProviderRefundStatus,
  type RefundInput,
  type StatementEntry,
  type WebhookEvent,
  WebhookVerificationError,
} from "./payment-provider.js";

export interface TapConfig {
  /** Test secret key (sk_test_…). env.ts refuses live keys while live payments are blocked. */
  secretKey: string;
  /** Public base URL of this API; Tap posts webhooks to <apiUrl>/v1/webhooks/payments/tap. */
  apiUrl: string;
  /** Where the hosted payment page sends the customer back (the customer app). */
  returnUrl: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

/** Thrown when Tap answers with an error; the caller keeps the attempt pending and retries. */
export class TapApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const CHARGE_STATUS: Record<string, ProviderPaymentStatus> = {
  INITIATED: "pending",
  IN_PROGRESS: "pending",
  "IN PROGRESS": "pending",
  UNKNOWN: "pending",
  CAPTURED: "captured",
  ABANDONED: "failed",
  CANCELLED: "failed",
  FAILED: "failed",
  DECLINED: "failed",
  RESTRICTED: "failed",
  VOID: "failed",
  TIMEDOUT: "failed",
};

const REFUND_STATUS: Record<string, ProviderRefundStatus> = {
  PENDING: "pending",
  ACCEPTED: "pending",
  UNKNOWN: "pending",
  TIMED_OUT: "pending",
  REFUNDED: "succeeded",
  DECLINED: "failed",
  FAILED: "failed",
  RESTRICTED: "failed",
  REJECTED: "failed",
};

/**
 * Integer fils to the decimal amount Tap expects (AED has 2 decimals). Built from strings, so
 * no floating-point arithmetic touches the money; JSON then carries the exact decimal text.
 */
export function filsToTapAmount(fils: bigint): number {
  if (fils < 0n) throw new RangeError("negative amount");
  const text = `${fils / 100n}.${(fils % 100n).toString().padStart(2, "0")}`;
  return Number(text);
}

/** Tap's decimal amount back to integer fils, from its text form ("12.5" → 1250n). */
export function tapAmountToFils(amount: unknown): bigint {
  const text = typeof amount === "number" ? String(amount) : String(amount ?? "");
  const m = /^(\d+)(?:\.(\d{1,3}))?$/.exec(text);
  if (!m) throw new TapApiError(502, `unexpected amount from Tap: ${text}`);
  const fraction = (m[2] ?? "").padEnd(3, "0");
  if (fraction[2] !== "0") throw new TapApiError(502, `AED amount with fractional fils: ${text}`);
  return BigInt(m[1]!) * 100n + BigInt(fraction.slice(0, 2));
}

interface TapCharge {
  id: string;
  status: string;
  amount: number | string;
  currency: string;
  transaction?: { url?: string; created?: string | number };
  reference?: { gateway?: string; payment?: string; idempotent?: string };
  response?: { code?: string; message?: string };
  created?: string | number;
}

interface TapRefund {
  id: string;
  status: string;
  amount: number | string;
  currency: string;
  charge_id: string;
  created?: string | number;
  reference?: { gateway?: string; payment?: string };
  response?: { code?: string };
}

/**
 * Tap Payments (founder decision D03: preferred provider), sandbox keys only.
 *
 * - Payments are Tap "charges" on the hosted page (`src_all`): the customer is redirected to
 *   `transaction.url`, then Tap posts a webhook and the reconciler fetches the charge again.
 * - Idempotency uses Tap's `reference.idempotent` (repeat within 24 hours returns the
 *   original), set to our stable attempt key, so a retried call never charges twice.
 * - Webhooks carry an HMAC-SHA256 `hashstring` over documented fields, keyed with the secret
 *   key. The event only names the object; its state is always fetched from Tap.
 * - Payouts: Tap settles to the merchant's bank on its own schedule and has no API we use for
 *   individual payouts here, so payouts stay manual (maker and checker) with this provider.
 *
 * Not yet verified against a live Tap sandbox account (needs the founder's Tap test keys).
 */
export class TapPaymentProvider implements PaymentProvider {
  readonly name = "tap";
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly config: TapConfig) {
    this.baseUrl = (config.baseUrl ?? "https://api.tap.company/v2").replace(/\/$/, "");
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  async createPayment(input: CreatePaymentInput): Promise<ProviderPayment> {
    const charge = await this.request<TapCharge>("POST", "/charges", {
      amount: filsToTapAmount(input.amountFils),
      currency: input.currency,
      threeDSecure: true,
      save_card: false,
      description: `Order ${input.orderId}`,
      metadata: { orderId: input.orderId },
      reference: {
        transaction: input.idempotencyKey,
        order: input.orderId,
        idempotent: input.idempotencyKey,
      },
      // No personal data is sent; Tap's hosted page asks for what it needs.
      customer: { first_name: "Customer" },
      source: { id: "src_all" },
      post: { url: `${this.config.apiUrl.replace(/\/$/, "")}/v1/webhooks/payments/tap` },
      redirect: { url: this.config.returnUrl },
    });
    return this.toPayment(charge);
  }

  async fetchPayment(providerRef: string): Promise<ProviderPayment | null> {
    const charge = await this.request<TapCharge>(
      "GET",
      `/charges/${encodeURIComponent(providerRef)}`,
      undefined,
      true,
    );
    return charge ? this.toPayment(charge) : null;
  }

  /** Tap answers a repeated idempotent create with the original charge, so ask the list. */
  async findByKey(idempotencyKey: string): Promise<ProviderPayment | null> {
    const page = await this.request<{ charges?: TapCharge[] }>("POST", "/charges/list", {
      reference: { transaction: idempotencyKey },
      limit: 1,
    });
    const charge =
      page.charges?.find((c) => c.reference?.idempotent === idempotencyKey) ?? page.charges?.[0];
    return charge ? this.toPayment(charge) : null;
  }

  async refund(input: RefundInput): Promise<ProviderRefund> {
    const refund = await this.request<TapRefund>("POST", "/refunds", {
      charge_id: input.paymentRef,
      amount: filsToTapAmount(input.amountFils),
      currency: input.currency,
      reason: "requested_by_customer",
      reference: { merchant: input.idempotencyKey, idempotent: input.idempotencyKey },
      post: { url: `${this.config.apiUrl.replace(/\/$/, "")}/v1/webhooks/payments/tap` },
    });
    return this.toRefund(refund);
  }

  async fetchRefund(providerRef: string): Promise<ProviderRefund | null> {
    const refund = await this.request<TapRefund>(
      "GET",
      `/refunds/${encodeURIComponent(providerRef)}`,
      undefined,
      true,
    );
    return refund ? this.toRefund(refund) : null;
  }

  initiatePayout(_input: PayoutInput): Promise<ProviderPayout> {
    return Promise.reject(
      new TapApiError(
        501,
        "Payouts are settled by Tap to the merchant's bank; record them manually",
      ),
    );
  }

  fetchPayout(_providerRef: string): Promise<ProviderPayout | null> {
    return Promise.resolve(null);
  }

  verifyWebhook(
    rawBody: Buffer,
    headers: Record<string, string | string[] | undefined>,
  ): WebhookEvent {
    const header = headers["hashstring"];
    const received = Array.isArray(header) ? header[0] : header;
    if (!received || !/^[0-9a-f]{64}$/i.test(received)) {
      throw new WebhookVerificationError("missing or malformed hashstring");
    }
    let body: TapCharge & { object?: string; charge_id?: string };
    try {
      body = JSON.parse(rawBody.toString("utf8")) as typeof body;
    } catch {
      throw new WebhookVerificationError("body is not JSON");
    }
    if (typeof body?.id !== "string" || typeof body.status !== "string") {
      throw new WebhookVerificationError("not a charge or refund");
    }
    const isRefund = body.object === "refund" || body.id.startsWith("re_");
    const created = isRefund ? body.created : body.transaction?.created;
    // Tap rounds the amount to the currency's decimals; accept its plain and fixed forms.
    const forms = new Set([String(body.amount), Number(body.amount).toFixed(2)]);
    const ok = [...forms].some((amount) => {
      const text =
        `x_id${body.id}x_amount${amount}x_currency${body.currency}` +
        `x_gateway_reference${body.reference?.gateway ?? ""}` +
        `x_payment_reference${body.reference?.payment ?? ""}` +
        `x_status${body.status}x_created${created ?? ""}`;
      const expected = Buffer.from(
        createHmac("sha256", this.config.secretKey).update(text).digest("hex"),
      );
      const actual = Buffer.from(received.toLowerCase());
      return expected.length === actual.length && timingSafeEqual(expected, actual);
    });
    if (!ok) throw new WebhookVerificationError("hashstring does not match");
    return {
      // Tap retries the same notification; a new status is a new event.
      eventId: `${body.id}:${body.status}`,
      type: `${isRefund ? "refund" : "payment"}.${body.status.toLowerCase()}`,
      objectType: isRefund ? "refund" : "payment",
      providerRef: body.id,
      createdAt: created ? new Date(Number(created)) : new Date(),
    };
  }

  async statement(from: Date, to: Date): Promise<StatementEntry[]> {
    const entries: StatementEntry[] = [];
    let startingAfter: string | undefined;
    for (let page = 0; page < 200; page++) {
      const result = await this.request<{ charges?: TapCharge[]; has_more?: boolean }>(
        "POST",
        "/charges/list",
        {
          period: { date: { from: from.getTime(), to: to.getTime() - 1 } },
          limit: 50,
          order: "chronological",
          ...(startingAfter && { starting_after: startingAfter }),
        },
      );
      const charges = result.charges ?? [];
      for (const c of charges) {
        entries.push({
          objectType: "payment",
          providerRef: c.id,
          status: CHARGE_STATUS[c.status] ?? "pending",
          amountFils: tapAmountToFils(c.amount),
          currency: c.currency,
          createdAt: new Date(Number(c.transaction?.created ?? c.created ?? from.getTime())),
        });
      }
      if (!result.has_more || charges.length === 0) break;
      startingAfter = charges[charges.length - 1]!.id;
    }
    return entries;
  }

  private toPayment(charge: TapCharge): ProviderPayment {
    const status = CHARGE_STATUS[charge.status] ?? "pending";
    const url = charge.transaction?.url;
    return {
      providerRef: charge.id,
      status,
      amountFils: tapAmountToFils(charge.amount),
      currency: charge.currency,
      ...(status === "failed" && {
        failureCode: (charge.response?.code ?? charge.status).toString().slice(0, 40),
      }),
      clientAction:
        status === "pending" && url && /^https:\/\//.test(url)
          ? { type: "redirect", url }
          : { type: "none" },
    };
  }

  private toRefund(refund: TapRefund): ProviderRefund {
    const status = REFUND_STATUS[refund.status] ?? "pending";
    return {
      providerRef: refund.id,
      paymentRef: refund.charge_id,
      status,
      amountFils: tapAmountToFils(refund.amount),
      currency: refund.currency,
      ...(status === "failed" && {
        failureCode: (refund.response?.code ?? refund.status).toString().slice(0, 40),
      }),
    };
  }

  private async request<T>(
    method: "GET" | "POST",
    path: string,
    body?: unknown,
    nullOn404?: false,
  ): Promise<T>;
  private async request<T>(
    method: "GET" | "POST",
    path: string,
    body: unknown,
    nullOn404: true,
  ): Promise<T | null>;
  private async request<T>(
    method: "GET" | "POST",
    path: string,
    body?: unknown,
    nullOn404 = false,
  ): Promise<T | null> {
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${this.config.secretKey}`,
        accept: "application/json",
        ...(body !== undefined && { "content-type": "application/json" }),
      },
      ...(body !== undefined && { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(15_000),
    });
    if (nullOn404 && response.status === 404) return null;
    const text = await response.text();
    if (!response.ok) {
      // Never log the request body or key; Tap's error codes are enough.
      let code = "";
      try {
        const parsed = JSON.parse(text) as { errors?: { code?: string }[] };
        code = parsed.errors?.map((e) => e.code).join(",") ?? "";
      } catch {
        // not JSON
      }
      throw new TapApiError(
        response.status,
        `Tap ${method} ${path} failed (${response.status} ${code})`,
      );
    }
    return JSON.parse(text) as T;
  }
}
