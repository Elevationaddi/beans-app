import { Module } from "@nestjs/common";
import {
  AdminEngagementController,
  EngagementController,
  MerchantEngagementController,
} from "./engagement.controllers.js";

/** Phase 9 (sandbox): stamp cards, promotions with admin review, dine-in tables, gifts. */
@Module({
  controllers: [EngagementController, MerchantEngagementController, AdminEngagementController],
})
export class EngagementModule {}
