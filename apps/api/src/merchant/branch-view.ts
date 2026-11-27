import type { MerchantBranch } from "@beans/contracts";
import type { Prisma } from "../generated/prisma/client.js";
import { localToday, timeToClock, type ClockInterval } from "../inventory/schedule.js";

export const branchSelect = {
  id: true,
  merchantId: true,
  nameEn: true,
  nameAr: true,
  address: true,
  lat: true,
  lng: true,
  phone: true,
  city: true,
  timezone: true,
  status: true,
  modes: true,
  capacity: true,
  createdAt: true,
  hours: { orderBy: [{ weekday: "asc" }, { opens: "asc" }] },
  exceptions: { orderBy: { localDate: "asc" } },
} satisfies Prisma.BranchSelect;

export type BranchRow = Prisma.BranchGetPayload<{ select: typeof branchSelect }>;

export function toBranchView(row: BranchRow, now: Date = new Date()): MerchantBranch {
  const today = localToday(row.timezone, now);
  return {
    id: row.id,
    merchantId: row.merchantId,
    nameEn: row.nameEn,
    nameAr: row.nameAr,
    address: row.address,
    lat: row.lat === null ? null : Number(row.lat),
    lng: row.lng === null ? null : Number(row.lng),
    phone: row.phone,
    city: row.city as MerchantBranch["city"],
    timezone: row.timezone,
    status: row.status,
    modes: row.modes as MerchantBranch["modes"],
    capacity: row.capacity,
    hours: row.hours.map((h) => ({
      weekday: h.weekday,
      opens: timeToClock(h.opens),
      closes: timeToClock(h.closes),
    })),
    exceptions: row.exceptions
      .map((e) => ({
        date: e.localDate.toISOString().slice(0, 10),
        closed: e.closed,
        intervals: e.intervals as unknown as ClockInterval[],
      }))
      .filter((e) => e.date >= today),
  };
}
