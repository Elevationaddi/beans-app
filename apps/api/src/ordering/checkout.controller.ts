import { Body, Controller, Inject, Post } from "@nestjs/common";
import {
  type CheckoutRequest,
  checkoutRequestSchema,
  type CheckoutResult,
  type CreateQuoteRequest,
  createQuoteRequestSchema,
  type Quote,
} from "@beans/contracts";
import { CurrentActor } from "../auth/current-actor.decorator.js";
import type { Actor } from "../common/request-context.js";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";
import { Idempotent } from "../idempotency/idempotent.interceptor.js";
import { CheckoutService } from "./checkout.service.js";
import { QuoteService } from "./quote.service.js";
import { LIMITS, RateLimit } from "../security/rate-limit.js";

@Controller()
export class CheckoutController {
  constructor(
    @Inject(QuoteService) private readonly quotes: QuoteService,
    @Inject(CheckoutService) private readonly checkouts: CheckoutService,
  ) {}

  @Post("quotes")
  @RateLimit(LIMITS.quote)
  async quote(
    @CurrentActor() actor: Actor,
    @Body(new ZodValidationPipe(createQuoteRequestSchema)) body: CreateQuoteRequest,
  ): Promise<{ data: Quote }> {
    return { data: await this.quotes.create(actor.userId, body) };
  }

  /** Requires an Idempotency-Key. To retry a failed payment, send the same quoteId with a new key. */
  @Post("checkout")
  @RateLimit(LIMITS.checkout)
  @Idempotent()
  async checkout(
    @CurrentActor() actor: Actor,
    @Body(new ZodValidationPipe(checkoutRequestSchema)) body: CheckoutRequest,
  ): Promise<{ data: CheckoutResult }> {
    return { data: await this.checkouts.checkout(actor.userId, body) };
  }
}
