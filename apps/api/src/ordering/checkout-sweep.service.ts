import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from "@nestjs/common";
import { ENV } from "../config/config.module.js";
import type { Env } from "../config/env.js";
import { PaymentReconciler } from "./payment-reconciler.service.js";

const SWEEP_INTERVAL_MS = 15_000;

/**
 * Periodically polls open payment attempts and releases expired holds (after reconciling).
 * Safe on several instances: every change locks the order row and is idempotent.
 * Phase 7 adds provider webhooks so most payments settle without polling.
 */
@Injectable()
export class CheckoutSweepService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger("CheckoutSweep");
  private timer: NodeJS.Timeout | undefined;
  private running: Promise<void> | undefined;

  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(PaymentReconciler) private readonly reconciler: PaymentReconciler,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.env.CHECKOUT_SWEEP_ENABLED) return;
    this.timer = setInterval(() => {
      if (this.running) return;
      this.running = this.reconciler
        .sweep()
        .then(({ polled, expired }) => {
          if (polled + expired > 0) this.logger.log(`polled ${polled}, expired ${expired}`);
        })
        .catch((error: Error) => this.logger.error(`Checkout sweep failed: ${error.message}`))
        .finally(() => {
          this.running = undefined;
        });
    }, SWEEP_INTERVAL_MS);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.running;
  }
}
