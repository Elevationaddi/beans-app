import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from "@nestjs/common";
import { ENV } from "../config/config.module.js";
import type { Env } from "../config/env.js";
import { PayoutService } from "../finance/payout.service.js";
import { RefundService } from "../finance/refund.service.js";
import { PaymentReconciler } from "../ordering/payment-reconciler.service.js";
import { PaymentWebhookService } from "./payment-webhook.service.js";

const SWEEP_INTERVAL_MS = 15_000;

/**
 * Background safety net for money flows, every 15 s: retries stored webhooks, polls open
 * payment attempts, releases expired holds (after reconciling), and retries or polls
 * approved refunds and payouts. Safe on several instances: every change locks its row and
 * is idempotent. Enabled by CHECKOUT_SWEEP_ENABLED.
 */
@Injectable()
export class PaymentSweepService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger("PaymentSweep");
  private timer: NodeJS.Timeout | undefined;
  private running: Promise<void> | undefined;

  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(PaymentWebhookService) private readonly webhooks: PaymentWebhookService,
    @Inject(PaymentReconciler) private readonly reconciler: PaymentReconciler,
    @Inject(RefundService) private readonly refunds: RefundService,
    @Inject(PayoutService) private readonly payouts: PayoutService,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.env.CHECKOUT_SWEEP_ENABLED) return;
    this.timer = setInterval(() => {
      if (this.running) return;
      this.running = this.sweepOnce()
        .catch((error: Error) => this.logger.error(`Payment sweep failed: ${error.message}`))
        .finally(() => {
          this.running = undefined;
        });
    }, SWEEP_INTERVAL_MS);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.running;
  }

  async sweepOnce(): Promise<void> {
    const webhooks = await this.webhooks.sweep();
    const { polled, expired } = await this.reconciler.sweep();
    const refunds = await this.refunds.sweep();
    const payouts = await this.payouts.sweep();
    if (webhooks + polled + expired + refunds + payouts > 0) {
      this.logger.log(
        `webhooks ${webhooks}, payments ${polled}, expired ${expired}, refunds ${refunds}, payouts ${payouts}`,
      );
    }
  }
}
