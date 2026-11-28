import { Global, Module } from "@nestjs/common";
import { AdminConsoleController } from "./admin-console.controller.js";
import { NotificationsController } from "./notifications.controller.js";
import { AdminPlatformController, PlatformController } from "./platform.controller.js";
import { SettingsService } from "./settings.service.js";

/** Cycle 2: platform settings and pause, admin console back end, in-app notifications. */
@Global()
@Module({
  controllers: [
    PlatformController,
    AdminPlatformController,
    AdminConsoleController,
    NotificationsController,
  ],
  providers: [SettingsService],
  exports: [SettingsService],
})
export class PlatformModule {}
