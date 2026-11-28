import { randomBytes } from "node:crypto";
import { Logger, Module } from "@nestjs/common";
import { ENV } from "../config/config.module.js";
import type { Env } from "../config/env.js";
import { FakePaymentProvider } from "./fake-payment.provider.js";
import { TapPaymentProvider } from "./tap-payment.provider.js";
import { PAYMENT_PROVIDER, WEBHOOK_SECRET } from "./payment-provider.js";

function webhookSecret(env: Env): string {
  if (env.PAYMENT_WEBHOOK_SECRET) return env.PAYMENT_WEBHOOK_SECRET;
  // env.ts requires the secret in production; elsewhere a per-process secret is enough.
  new Logger("PaymentsModule").warn(
    "PAYMENT_WEBHOOK_SECRET not set; using a random per-process secret",
  );
  return randomBytes(32).toString("hex");
}

@Module({
  providers: [
    { provide: WEBHOOK_SECRET, inject: [ENV], useFactory: webhookSecret },
    FakePaymentProvider,
    {
      provide: PAYMENT_PROVIDER,
      inject: [ENV, FakePaymentProvider],
      useFactory: (env: Env, fake: FakePaymentProvider) => {
        // env.ts refuses the fake provider in production and Tap live keys everywhere.
        if (env.PAYMENT_PROVIDER === "fake") return fake;
        if (env.PAYMENT_PROVIDER === "tap" && env.TAP_SECRET_KEY && env.TAP_RETURN_URL) {
          return new TapPaymentProvider({
            secretKey: env.TAP_SECRET_KEY,
            apiUrl: env.API_PUBLIC_URL ?? "",
            returnUrl: env.TAP_RETURN_URL,
          });
        }
        throw new Error(`unsupported payment provider: ${String(env.PAYMENT_PROVIDER)}`);
      },
    },
  ],
  exports: [PAYMENT_PROVIDER, FakePaymentProvider],
})
export class PaymentsModule {}
