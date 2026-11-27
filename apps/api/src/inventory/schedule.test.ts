import { describe, expect, it } from "vitest";
import {
  distanceMeters,
  intervalProblems,
  isOpenAt,
  isoWeekday,
  localToday,
  slotStarts,
  zonedToUtc,
} from "./schedule.js";

describe("schedule", () => {
  it("rejects reversed and overlapping intervals and accepts split overnight hours", () => {
    expect(intervalProblems([{ opens: "22:00", closes: "02:00" }])).toHaveLength(1);
    expect(
      intervalProblems([
        { opens: "07:00", closes: "12:00" },
        { opens: "11:30", closes: "15:00" },
      ]),
    ).toEqual(["07:00-12:00 overlaps 11:30-15:00"]);
    expect(
      intervalProblems([
        { opens: "00:00", closes: "02:00" },
        { opens: "18:00", closes: "23:59" },
      ]),
    ).toEqual([]);
    // Touching intervals do not overlap.
    expect(
      intervalProblems([
        { opens: "07:00", closes: "12:00" },
        { opens: "12:00", closes: "15:00" },
      ]),
    ).toEqual([]);
  });

  it("converts Dubai wall-clock time to UTC (+04:00, no daylight saving)", () => {
    expect(zonedToUtc("2026-12-01", 7 * 60, "Asia/Dubai").toISOString()).toBe(
      "2026-12-01T03:00:00.000Z",
    );
    expect(zonedToUtc("2026-12-01", 2 * 60, "Asia/Dubai").toISOString()).toBe(
      "2026-11-30T22:00:00.000Z",
    );
  });

  it("handles a zone with daylight saving", () => {
    expect(zonedToUtc("2026-07-01", 9 * 60, "Europe/London").toISOString()).toBe(
      "2026-07-01T08:00:00.000Z",
    );
    expect(zonedToUtc("2026-12-01", 9 * 60, "Europe/London").toISOString()).toBe(
      "2026-12-01T09:00:00.000Z",
    );
  });

  it("knows the local date and ISO weekday", () => {
    expect(localToday("Asia/Dubai", new Date("2026-11-30T21:00:00Z"))).toBe("2026-12-01");
    expect(isoWeekday("2026-11-30")).toBe(1);
    expect(isoWeekday("2026-12-06")).toBe(7);
  });

  it("cuts intervals into whole 15-minute slots", () => {
    const starts = slotStarts("2026-12-01", [{ opens: "07:00", closes: "08:10" }], "Asia/Dubai");
    expect(starts.map((d) => d.toISOString())).toEqual([
      "2026-12-01T03:00:00.000Z",
      "2026-12-01T03:15:00.000Z",
      "2026-12-01T03:30:00.000Z",
      "2026-12-01T03:45:00.000Z",
    ]);
  });
});

describe("opening state", () => {
  const hours = [{ weekday: 2, opens: "07:00", closes: "12:00" }];

  it("is open inside the interval in branch time and closed at the closing minute", () => {
    // Tuesday 2026-12-01 07:30 Dubai = 03:30 UTC.
    expect(isOpenAt("Asia/Dubai", hours, [], new Date("2026-12-01T03:30:00Z"))).toBe(true);
    expect(isOpenAt("Asia/Dubai", hours, [], new Date("2026-12-01T08:00:00Z"))).toBe(false);
    expect(isOpenAt("Asia/Dubai", hours, [], new Date("2026-12-01T02:59:00Z"))).toBe(false);
  });

  it("lets a holiday exception override the weekly hours", () => {
    const closed = [{ date: "2026-12-01", closed: true, intervals: [] }];
    expect(isOpenAt("Asia/Dubai", hours, closed, new Date("2026-12-01T03:30:00Z"))).toBe(false);
    const special = [
      { date: "2026-12-02", closed: false, intervals: [{ opens: "10:00", closes: "11:00" }] },
    ];
    expect(isOpenAt("Asia/Dubai", hours, special, new Date("2026-12-02T06:30:00Z"))).toBe(true);
  });

  it("measures distance", () => {
    // Roughly 1.1 km per 0.01° latitude.
    expect(distanceMeters({ lat: 24.45, lng: 54.37 }, { lat: 24.46, lng: 54.37 })).toBe(1112);
  });
});
