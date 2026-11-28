import { Global, Module } from "@nestjs/common";
import { BenefitsService } from "./benefits.service.js";
import { tableTokenProviders, TableTokens } from "./table-tokens.js";

/** Phase 9 services used by ordering and finance: benefits and dine-in table tokens. */
@Global()
@Module({
  providers: [BenefitsService, ...tableTokenProviders],
  exports: [BenefitsService, TableTokens],
})
export class EngagementCoreModule {}
