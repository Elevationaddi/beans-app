import { Module } from "@nestjs/common";
import { InventoryModule } from "../inventory/inventory.module.js";
import { BranchesPublicController } from "./branches-public.controller.js";
import { DiscoveryService } from "./discovery.service.js";
import { FavoritesController } from "./favorites.controller.js";

@Module({
  imports: [InventoryModule],
  controllers: [BranchesPublicController, FavoritesController],
  providers: [DiscoveryService],
  exports: [DiscoveryService],
})
export class DiscoveryModule {}
