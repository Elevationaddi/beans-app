import { Module, type DynamicModule } from "@nestjs/common";
import { AdminModule } from "./admin/admin.module.js";
import { AuditModule } from "./audit/audit.module.js";
import { AuthModule } from "./auth/auth.module.js";
import { CatalogModule } from "./catalog/catalog.module.js";
import { ConfigModule } from "./config/config.module.js";
import type { Env } from "./config/env.js";
import { DatabaseModule } from "./database/database.module.js";
import { DiscoveryModule } from "./discovery/discovery.module.js";
import { FinanceModule } from "./finance/finance.module.js";
import { FulfillmentModule } from "./fulfillment/fulfillment.module.js";
import { FilesModule } from "./files/files.module.js";
import { HealthModule } from "./health/health.module.js";
import { IdempotencyModule } from "./idempotency/idempotency.module.js";
import { MeModule } from "./me/me.module.js";
import { MerchantModule } from "./merchant/merchant.module.js";
import { OnboardingModule } from "./onboarding/onboarding.module.js";
import { OrderingModule } from "./ordering/ordering.module.js";
import { OutboxModule } from "./outbox/outbox.module.js";
import { RealtimeModule } from "./realtime/realtime.module.js";
import { RedisModule } from "./redis/redis.module.js";
import { StaffModule } from "./staff/staff.module.js";
import { WebhooksModule } from "./webhooks/webhooks.module.js";
import { TenancyModule } from "./tenancy/tenancy.module.js";

/** Root module: one modular backend (CLAUDE.md). Business modules join in later phases. */
@Module({})
export class AppModule {
  static forRoot(env: Env): DynamicModule {
    return {
      module: AppModule,
      imports: [
        ConfigModule.forRoot(env),
        DatabaseModule,
        RedisModule,
        RealtimeModule,
        AuthModule,
        TenancyModule,
        AuditModule,
        IdempotencyModule,
        OutboxModule,
        FilesModule,
        HealthModule,
        MeModule,
        MerchantModule,
        CatalogModule,
        StaffModule,
        DiscoveryModule,
        OrderingModule,
        FinanceModule,
        FulfillmentModule,
        WebhooksModule,
        OnboardingModule,
        AdminModule,
      ],
    };
  }
}
