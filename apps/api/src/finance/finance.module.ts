import { Module } from "@nestjs/common";
import { PaymentsModule } from "../payments/payments.module.js";
import { AdminFinanceController } from "./admin-finance.controller.js";
import { LedgerService } from "./ledger.service.js";
import { PayoutService } from "./payout.service.js";
import { ReconciliationService } from "./reconciliation.service.js";
import { RefundService } from "./refund.service.js";

/** Phase 7: ledger, refunds with dual control, reconciliation and sandbox payouts. */
@Module({
  imports: [PaymentsModule],
  controllers: [AdminFinanceController],
  providers: [LedgerService, RefundService, PayoutService, ReconciliationService],
  exports: [LedgerService, RefundService, PayoutService, ReconciliationService],
})
export class FinanceModule {}
