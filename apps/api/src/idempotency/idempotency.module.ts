import { Global, Module } from "@nestjs/common";
import { IdempotencyService } from "./idempotency.service.js";
import { IdempotentInterceptor } from "./idempotent.interceptor.js";

@Global()
@Module({
  providers: [IdempotencyService, IdempotentInterceptor],
  exports: [IdempotencyService, IdempotentInterceptor],
})
export class IdempotencyModule {}
