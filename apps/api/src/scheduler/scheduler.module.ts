import { Module } from "@nestjs/common";
import { WebhooksModule } from "../webhooks/webhooks.module.js";
import { CronController } from "./cron.controller.js";

/** Cron entry point for serverless hosting (docs/22). */
@Module({ imports: [WebhooksModule], controllers: [CronController] })
export class SchedulerModule {}
