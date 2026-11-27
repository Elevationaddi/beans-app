import { Module } from "@nestjs/common";
import { DiscoveryModule } from "../discovery/discovery.module.js";
import { FinanceModule } from "../finance/finance.module.js";
import { InventoryModule } from "../inventory/inventory.module.js";
import { PaymentsModule } from "../payments/payments.module.js";
import { CartController } from "./cart.controller.js";
import { CartService } from "./cart.service.js";
import { CheckoutController } from "./checkout.controller.js";
import { CheckoutService } from "./checkout.service.js";
import { OrdersController } from "./orders.controller.js";
import { PaymentReconciler } from "./payment-reconciler.service.js";
import { QuoteService } from "./quote.service.js";
import { VehiclesController } from "./vehicles.controller.js";

/** Phase 6: vehicles, cart, quotes, checkout with sandbox payments, and customer orders. */
@Module({
  imports: [DiscoveryModule, InventoryModule, PaymentsModule, FinanceModule],
  controllers: [VehiclesController, CartController, CheckoutController, OrdersController],
  providers: [CartService, QuoteService, CheckoutService, PaymentReconciler],
  exports: [PaymentReconciler],
})
export class OrderingModule {}
