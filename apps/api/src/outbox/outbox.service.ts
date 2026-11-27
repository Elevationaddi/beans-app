import { Injectable } from "@nestjs/common";
import type { Prisma } from "../generated/prisma/client.js";

export interface OutboxEntry {
  topic: string;
  aggregateId: string;
  /** Globally unique: the same business event is enqueued once however often it is retried. */
  dedupeKey: string;
  payload: Prisma.InputJsonObject;
}

/**
 * Transactional outbox: write the event in the same database transaction as the state
 * change, so either both commit or neither does. The relay publishes it afterwards.
 */
@Injectable()
export class OutboxService {
  /** Returns false when an event with this dedupe key already exists. */
  async enqueue(tx: Prisma.TransactionClient, entry: OutboxEntry): Promise<boolean> {
    const result = await tx.outboxMessage.createMany({
      data: [entry],
      skipDuplicates: true,
    });
    return result.count === 1;
  }
}
