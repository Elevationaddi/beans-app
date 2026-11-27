import { Module } from "@nestjs/common";
import { SlotService } from "./slot.service.js";
import { StockService } from "./stock.service.js";

@Module({ providers: [SlotService, StockService], exports: [SlotService, StockService] })
export class InventoryModule {}
