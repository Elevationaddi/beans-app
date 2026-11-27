/**
 * Branch-local schedule arithmetic. Opening hours are stored as wall-clock times in the
 * branch timezone (Asia/Dubai by default); slots are stored as UTC instants.
 */

/** Pickup slot length in minutes: sandbox value from the proposed decision D10. */
export const SLOT_MINUTES = 15;

export interface ClockInterval {
  opens: string;
  closes: string;
}

/** "HH:MM" → minutes after midnight. */
export function clockMinutes(value: string): number {
  const [hours, minutes] = value.split(":").map(Number);
  return (hours ?? 0) * 60 + (minutes ?? 0);
}

/** Prisma represents a Postgres TIME as a Date on 1970-01-01 UTC. */
export function clockToTime(value: string): Date {
  return new Date(`1970-01-01T${value}:00.000Z`);
}

export function timeToClock(value: Date): string {
  return value.toISOString().slice(11, 16);
}

/**
 * Problems with a set of intervals for one day: empty or reversed intervals (overnight
 * opening must be split at midnight) and overlaps. Returns messages; empty means valid.
 */
export function intervalProblems(intervals: readonly ClockInterval[]): string[] {
  const problems: string[] = [];
  const sorted = [...intervals].sort((a, b) => clockMinutes(a.opens) - clockMinutes(b.opens));
  for (const interval of sorted) {
    if (clockMinutes(interval.opens) >= clockMinutes(interval.closes)) {
      problems.push(
        `${interval.opens}-${interval.closes} must close after it opens; split overnight hours at midnight`,
      );
    }
  }
  for (let i = 1; i < sorted.length; i += 1) {
    const previous = sorted[i - 1];
    const current = sorted[i];
    if (previous && current && clockMinutes(current.opens) < clockMinutes(previous.closes)) {
      problems.push(
        `${previous.opens}-${previous.closes} overlaps ${current.opens}-${current.closes}`,
      );
    }
  }
  return problems;
}

/** ISO weekday (1 = Monday … 7 = Sunday) of a calendar date. */
export function isoWeekday(localDate: string): number {
  const day = new Date(`${localDate}T00:00:00.000Z`).getUTCDay();
  return day === 0 ? 7 : day;
}

/** Offset of `timeZone` from UTC at `instant`, in minutes (Dubai: +240). */
function offsetMinutes(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second"),
  );
  return Math.round((asUtc - instant.getTime()) / 60_000);
}

/** The UTC instant of a wall-clock time on a local date in `timeZone`. */
export function zonedToUtc(
  localDate: string,
  minutesAfterMidnight: number,
  timeZone: string,
): Date {
  const naive = new Date(`${localDate}T00:00:00.000Z`).getTime() + minutesAfterMidnight * 60_000;
  const first = naive - offsetMinutes(new Date(naive), timeZone) * 60_000;
  // Re-check at the candidate instant in case a DST change sits between the two.
  return new Date(naive - offsetMinutes(new Date(first), timeZone) * 60_000);
}

/** Today's calendar date in `timeZone`. */
export function localToday(timeZone: string, now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** Slot start instants covering the intervals of one local date. */
export function slotStarts(
  localDate: string,
  intervals: readonly ClockInterval[],
  timeZone: string,
  slotMinutes = SLOT_MINUTES,
): Date[] {
  const starts: Date[] = [];
  for (const interval of intervals) {
    const end = clockMinutes(interval.closes);
    for (
      let minute = clockMinutes(interval.opens);
      minute + slotMinutes <= end;
      minute += slotMinutes
    ) {
      starts.push(zonedToUtc(localDate, minute, timeZone));
    }
  }
  return starts.sort((a, b) => a.getTime() - b.getTime());
}
