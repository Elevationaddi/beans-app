import { Module } from "@nestjs/common";
import { FinanceModule } from "../finance/finance.module.js";
import { InventoryModule } from "../inventory/inventory.module.js";
import { OrderingModule } from "../ordering/ordering.module.js";
import { AdminOrdersController } from "./admin-orders.controller.js";
import { CustomerOrdersController } from "./customer-orders.controller.js";
import { FulfillmentService } from "./fulfillment.service.js";
import { MerchantOrdersController } from "./merchant-orders.controller.js";

/** Phase 8: branch queue, staff steps, curbside, handoff, cancellations, receipts, live updates. */
@Module({
  imports: [OrderingModule, FinanceModule, InventoryModule],
  controllers: [MerchantOrdersController, CustomerOrdersController, AdminOrdersController],
  providers: [FulfillmentService],
  exports: [FulfillmentService],
})
export class FulfillmentModule {}
