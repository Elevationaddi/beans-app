import { Module } from "@nestjs/common";
import { ENV } from "../config/config.module.js";
import type { Env } from "../config/env.js";
import { FakePaymentProvider } from "./fake-payment.provider.js";
import { PAYMENT_PROVIDER } from "./payment-provider.js";

@Module({
  providers: [
    FakePaymentProvider,
    {
      provide: PAYMENT_PROVIDER,
      inject: [ENV, FakePaymentProvider],
      useFactory: (env: Env, fake: FakePaymentProvider) => {
        // Only the sandbox provider exists; env.ts refuses it in production.
        if (env.PAYMENT_PROVIDER === "fake") return fake;
        throw new Error(`unsupported payment provider: ${String(env.PAYMENT_PROVIDER)}`);
      },
    },
  ],
  exports: [PAYMENT_PROVIDER, FakePaymentProvider],
})
export class PaymentsModule {}
