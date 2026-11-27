import { Module } from "@nestjs/common";
import { FinanceModule } from "../finance/finance.module.js";
import { OrderingModule } from "../ordering/ordering.module.js";
import { PaymentsModule } from "../payments/payments.module.js";
import { PaymentSweepService } from "./payment-sweep.service.js";
import { PaymentWebhookService } from "./payment-webhook.service.js";
import { PaymentWebhooksController } from "./payment-webhooks.controller.js";

/** Provider webhooks and the background payment sweep. */
@Module({
  imports: [PaymentsModule, OrderingModule, FinanceModule],
  controllers: [PaymentWebhooksController],
  providers: [PaymentWebhookService, PaymentSweepService],
  exports: [PaymentWebhookService, PaymentSweepService],
})
export class WebhooksModule {}
