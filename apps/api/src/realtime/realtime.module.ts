import { Global, Module } from "@nestjs/common";
import { RealtimeService } from "./realtime.service.js";

/** Live order updates over Redis pub/sub (phase 8). */
@Global()
@Module({ providers: [RealtimeService], exports: [RealtimeService] })
export class RealtimeModule {}
