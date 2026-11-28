import { Inject, Injectable, Logger, type OnModuleDestroy } from "@nestjs/common";
import { PrismaPg } from "@prisma/adapter-pg";
import { ENV } from "../config/config.module.js";
import type { Env } from "../config/env.js";
import { PrismaClient } from "../generated/prisma/client.js";

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor(@Inject(ENV) env: Env) {
    // A small pool per instance: on serverless hosting every instance has its own pool, so the
    // database (through Supabase's transaction pooler) sees instances × DATABASE_POOL_MAX.
    super({
      adapter: new PrismaPg({ connectionString: env.DATABASE_URL, max: env.DATABASE_POOL_MAX }),
    });
  }

  /** True when the database answers a trivial query. Never throws. */
  async isHealthy(): Promise<boolean> {
    try {
      await this.$queryRaw`SELECT 1`;
      return true;
    } catch (error) {
      this.logger.warn(`Database health check failed: ${(error as Error).message}`);
      return false;
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
