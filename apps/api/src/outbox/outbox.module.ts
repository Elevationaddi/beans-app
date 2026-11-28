import { Global, Module } from "@nestjs/common";
import { SupabaseAdminService } from "../auth/supabase-admin.service.js";
import { OUTBOX_PUBLISHER, OutboxRelayService } from "./outbox-relay.service.js";
import { OutboxWorkerService } from "./outbox-worker.service.js";
import { OutboxService } from "./outbox.service.js";

@Global()
@Module({
  providers: [
    OutboxService,
    OutboxRelayService,
    OutboxWorkerService,
    SupabaseAdminService,
    { provide: OUTBOX_PUBLISHER, useExisting: OutboxWorkerService },
  ],
  exports: [OutboxService, OutboxRelayService],
})
export class OutboxModule {}
