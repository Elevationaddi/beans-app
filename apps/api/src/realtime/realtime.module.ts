import { Global, Module } from "@nestjs/common";
import { RealtimeService } from "./realtime.service.js";

/** Live order updates: in-process streams, plus Supabase Realtime Broadcast when configured. */
@Global()
@Module({ providers: [RealtimeService], exports: [RealtimeService] })
export class RealtimeModule {}
