import { Module } from "@nestjs/common";
import { AdminAuditController } from "./admin-audit.controller.js";

@Module({ controllers: [AdminAuditController] })
export class AdminModule {}
