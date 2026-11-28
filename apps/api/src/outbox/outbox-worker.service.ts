import { Inject, Injectable } from "@nestjs/common";
import { ACCOUNT_DELETED_TOPIC, SupabaseAdminService } from "../auth/supabase-admin.service.js";
import { FILE_SCAN_TOPIC, FilesService } from "../files/files.service.js";
import { parseSignal, RealtimeService } from "../realtime/realtime.service.js";
import type { OutboxPublisher } from "./outbox-relay.service.js";

export const ORDER_UPDATED_TOPIC = "order.updated";

/**
 * Events recorded for notifications that are not sent yet (no real notifications without the
 * founder's approval). They are acknowledged so they do not retry forever; the outbox keeps the
 * rows, so a notification sender added later can replay them.
 */
export const NOTIFICATION_ONLY_TOPICS: ReadonlySet<string> = new Set([
  "customer.payment_refunded",
  "merchant.application_submitted",
  "merchant.status_changed",
  "payout.updated",
  "refund.updated",
  "staff.invited",
]);

/**
 * Runs outbox events in this process. Handlers must be idempotent: a row can be handled more
 * than once (a retry, or a lease that expired on a frozen serverless instance).
 */
@Injectable()
export class OutboxWorkerService implements OutboxPublisher {
  constructor(
    @Inject(FilesService) private readonly files: FilesService,
    @Inject(RealtimeService) private readonly realtime: RealtimeService,
    @Inject(SupabaseAdminService) private readonly supabaseAdmin: SupabaseAdminService,
  ) {}

  async publish(message: { topic: string; aggregateId: string; payload: unknown }): Promise<void> {
    switch (message.topic) {
      case FILE_SCAN_TOPIC:
        return this.files.scan(message.aggregateId);
      case ORDER_UPDATED_TOPIC:
        return this.publishOrderUpdate(message.payload);
      case ACCOUNT_DELETED_TOPIC: {
        const subject = (message.payload as { authSubject?: unknown } | null)?.authSubject;
        if (typeof subject !== "string" || !subject) {
          throw new Error("account.deleted payload is missing authSubject");
        }
        await this.supabaseAdmin.deleteAuthUser(subject);
        return;
      }
      default:
        if (NOTIFICATION_ONLY_TOPICS.has(message.topic)) return;
        throw new Error(`No handler for topic ${message.topic}`);
    }
  }

  /** Committed order change → live updates. Re-publishing is harmless (clients refetch). */
  async publishOrderUpdate(payload: unknown): Promise<void> {
    const signal = parseSignal(payload);
    if (!signal) throw new Error("order.updated payload is missing fields");
    await this.realtime.publish(signal);
  }

  async close(): Promise<void> {}
}
