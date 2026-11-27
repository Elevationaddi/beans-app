import { Inject, Injectable } from "@nestjs/common";
import { ApiError } from "../common/api-error.js";
import { PrismaService } from "../database/prisma.service.js";
import type { Prisma, Slot } from "../generated/prisma/client.js";
import { type ClockInterval, isoWeekday, slotStarts, timeToClock, zonedToUtc } from "./schedule.js";

type Db = Prisma.TransactionClient | PrismaService;

function nextDate(localDate: string): string {
  const next = new Date(`${localDate}T00:00:00.000Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString().slice(0, 10);
}

/**
 * Pickup capacity per 15-minute slot (sandbox length, decision D10). Slots are derived from
 * the branch's hours or that day's exception, each with the branch capacity. Holding a place
 * is a single conditional UPDATE, and the database CHECK (reserved + confirmed <= capacity)
 * backs it up, so concurrent checkouts cannot oversell a slot.
 */
@Injectable()
export class SlotService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /** Opening intervals for one local date: the exception if there is one, else weekly hours. */
  async openIntervals(db: Db, branchId: string, localDate: string): Promise<ClockInterval[]> {
    const exception = await db.branchException.findUnique({
      where: {
        branchId_localDate: { branchId, localDate: new Date(`${localDate}T00:00:00.000Z`) },
      },
    });
    if (exception) {
      return exception.closed ? [] : (exception.intervals as unknown as ClockInterval[]);
    }
    const hours = await db.branchHour.findMany({
      where: { branchId, weekday: isoWeekday(localDate) },
      orderBy: { opens: "asc" },
    });
    return hours.map((h) => ({ opens: timeToClock(h.opens), closes: timeToClock(h.closes) }));
  }

  /**
   * Brings the slots of one local date in line with the current schedule and returns them:
   * creates missing slots, and removes slots outside opening hours that hold no orders.
   * Slots that already hold orders are kept, so a schedule change never drops a pickup.
   */
  async ensureSlots(branchId: string, localDate: string): Promise<Slot[]> {
    return this.prisma.$transaction(async (tx) => {
      // Serialize reconciliation per branch so two requests do not race on the same day.
      await tx.$executeRaw`SELECT 1 FROM branches WHERE id = ${branchId}::uuid FOR UPDATE`;
      const branch = await tx.branch.findUniqueOrThrow({
        where: { id: branchId },
        select: { timezone: true, capacity: true },
      });
      const intervals = await this.openIntervals(tx, branchId, localDate);
      const starts = slotStarts(localDate, intervals, branch.timezone);
      const dayStart = zonedToUtc(localDate, 0, branch.timezone);
      const dayEnd = zonedToUtc(nextDate(localDate), 0, branch.timezone);

      if (starts.length > 0) {
        await tx.slot.createMany({
          data: starts.map((startsAt) => ({ branchId, startsAt, capacity: branch.capacity })),
          skipDuplicates: true,
        });
      }
      await tx.slot.deleteMany({
        where: {
          branchId,
          startsAt: { gte: dayStart, lt: dayEnd, notIn: starts },
          reserved: 0,
          confirmed: 0,
        },
      });
      return tx.slot.findMany({
        where: { branchId, startsAt: { gte: dayStart, lt: dayEnd } },
        orderBy: { startsAt: "asc" },
      });
    });
  }

  /** Applies a new branch capacity to future slots, never below what they already hold. */
  async applyCapacity(
    tx: Prisma.TransactionClient,
    branchId: string,
    capacity: number,
  ): Promise<void> {
    await tx.$executeRaw`
      UPDATE slots SET capacity = GREATEST(${capacity}::int, reserved + confirmed), updated_at = now()
      WHERE branch_id = ${branchId}::uuid AND starts_at >= now()`;
  }

  /** Holds `count` places in a slot. Returns false when the slot is full. */
  async hold(tx: Db, slotId: string, count = 1): Promise<boolean> {
    if (!Number.isInteger(count) || count < 1)
      throw ApiError.validation({ count: ["Must be a positive integer"] });
    const updated = await tx.$executeRaw`
      UPDATE slots SET reserved = reserved + ${count}::int, updated_at = now()
      WHERE id = ${slotId}::uuid AND reserved + confirmed + ${count}::int <= capacity`;
    return updated === 1;
  }

  /** Releases places held by an order that did not go ahead. */
  async release(tx: Db, slotId: string, count = 1): Promise<boolean> {
    const updated = await tx.$executeRaw`
      UPDATE slots SET reserved = reserved - ${count}::int, updated_at = now()
      WHERE id = ${slotId}::uuid AND reserved >= ${count}::int`;
    return updated === 1;
  }
}
