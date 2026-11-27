import { Module } from "@nestjs/common";
import { InventoryModule } from "../inventory/inventory.module.js";
import { MerchantBranchesController } from "./merchant-branches.controller.js";

@Module({ imports: [InventoryModule], controllers: [MerchantBranchesController] })
export class MerchantModule {}
