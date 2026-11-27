import { Controller, HttpCode, Inject, Param, Post, Req } from "@nestjs/common";
import { webhookParamsSchema } from "@beans/contracts";
import { Public } from "../auth/public.decorator.js";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";
import { PaymentWebhookService } from "./payment-webhook.service.js";
import { LIMITS, RateLimit } from "../security/rate-limit.js";

interface RawRequest {
  rawBody?: Buffer;
  headers: Record<string, string | string[] | undefined>;
}

/** Provider notifications. Authenticated by the provider signature, not a user token. */
@Controller("webhooks/payments")
export class PaymentWebhooksController {
  constructor(@Inject(PaymentWebhookService) private readonly webhooks: PaymentWebhookService) {}

  @Public()
  @Post(":provider")
  @RateLimit(LIMITS.webhook)
  @HttpCode(200)
  async receive(
    @Param(new ZodValidationPipe(webhookParamsSchema)) params: { provider: string },
    @Req() req: RawRequest,
  ) {
    return { data: await this.webhooks.receive(params.provider, req.rawBody, req.headers) };
  }
}
