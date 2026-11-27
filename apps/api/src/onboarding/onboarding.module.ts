import { Module } from "@nestjs/common";
import { AdminMerchantsController } from "./admin-merchants.controller.js";
import { ApplicationsController } from "./applications.controller.js";

@Module({ controllers: [ApplicationsController, AdminMerchantsController] })
export class OnboardingModule {}
