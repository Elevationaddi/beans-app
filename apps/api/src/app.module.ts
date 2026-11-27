import { Module, type DynamicModule } from "@nestjs/common";
import { ConfigModule } from "./config/config.module.js";
import type { Env } from "./config/env.js";
import { DatabaseModule } from "./database/database.module.js";
import { HealthModule } from "./health/health.module.js";
import { RedisModule } from "./redis/redis.module.js";

/** Root module. Business modules (identity, catalog, orders, finance...) join in later phases. */
@Module({})
export class AppModule {
  static forRoot(env: Env): DynamicModule {
    return {
      module: AppModule,
      imports: [ConfigModule.forRoot(env), DatabaseModule, RedisModule, HealthModule],
    };
  }
}
