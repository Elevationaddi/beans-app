import { Module, type DynamicModule } from "@nestjs/common";
import { AdminModule } from "./admin/admin.module.js";
import { AuditModule } from "./audit/audit.module.js";
import { AuthModule } from "./auth/auth.module.js";
import { ConfigModule } from "./config/config.module.js";
import type { Env } from "./config/env.js";
import { DatabaseModule } from "./database/database.module.js";
import { HealthModule } from "./health/health.module.js";
import { IdempotencyModule } from "./idempotency/idempotency.module.js";
import { MeModule } from "./me/me.module.js";
import { MerchantModule } from "./merchant/merchant.module.js";
import { OutboxModule } from "./outbox/outbox.module.js";
import { RedisModule } from "./redis/redis.module.js";
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
        AuthModule,
        TenancyModule,
        AuditModule,
        IdempotencyModule,
        OutboxModule,
        HealthModule,
        MeModule,
        MerchantModule,
        AdminModule,
      ],
    };
  }
}
