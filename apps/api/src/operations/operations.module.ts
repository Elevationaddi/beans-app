import { Module } from "@nestjs/common";
import { AdminInsightsController, MerchantInsightsController } from "./insights.controller.js";
import { InsightsService } from "./insights.service.js";
import {
  AdminTicketsController,
  PrivacyRequestsController,
  TicketsController,
} from "./tickets.controller.js";
import { TicketsService } from "./tickets.service.js";

/** Phase 10: support tickets, privacy requests, dashboards, analytics, reports, settings. */
@Module({
  controllers: [
    TicketsController,
    PrivacyRequestsController,
    AdminTicketsController,
    MerchantInsightsController,
    AdminInsightsController,
  ],
  providers: [TicketsService, InsightsService],
})
export class OperationsModule {}
