import { Global, Module } from "@nestjs/common";
import { MerchantAccessService } from "./merchant-access.service.js";

@Global()
@Module({
  providers: [MerchantAccessService],
  exports: [MerchantAccessService],
})
export class TenancyModule {}
