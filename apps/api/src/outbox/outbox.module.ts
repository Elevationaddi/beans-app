import { Global, Module } from "@nestjs/common";
import { ENV } from "../config/config.module.js";
import type { Env } from "../config/env.js";
import {
  BullMqOutboxPublisher,
  OUTBOX_PUBLISHER,
  OutboxRelayService,
} from "./outbox-relay.service.js";
import { OutboxWorkerService } from "./outbox-worker.service.js";
import { OutboxService } from "./outbox.service.js";

@Global()
@Module({
  providers: [
    OutboxService,
    OutboxRelayService,
    OutboxWorkerService,
    {
      provide: OUTBOX_PUBLISHER,
      useFactory: (env: Env) => new BullMqOutboxPublisher(env.REDIS_URL),
      inject: [ENV],
    },
  ],
  exports: [OutboxService, OutboxRelayService],
})
export class OutboxModule {}
