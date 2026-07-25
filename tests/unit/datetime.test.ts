import { describe, expect, it } from "vitest";

import {
  formatAppointmentTime,
  formatInTimeZone,
  isSupportedTimeZone,
  isValidTimeZone,
  shortTimeZoneName,
  wallClockToUtc,
} from "@/lib/datetime";

/**
 * Appointment times are the one place where a time-zone bug becomes a person
 * sitting in a waiting room alone, so the conversions get real tests.
 */

describe("time zone validation", () => {
  it("accepts the curated US list", () => {
    expect(isSupportedTimeZone("America/New_York")).toBe(true);
    expect(isSupportedTimeZone("Europe/London")).toBe(false);
  });

  it("still validates any real IANA zone, so the model stays extensible", () => {
    expect(isValidTimeZone("Europe/London")).toBe(true);
    expect(isValidTimeZone("Mars/Olympus_Mons")).toBe(false);
  });
});

describe("wallClockToUtc", () => {
  it("converts a winter morning in New York to the correct UTC instant", () => {
    // 2025-03-04 is before US daylight saving begins, so EST (UTC-5).
    const result = wallClockToUtc("2025-03-04", "09:00", "America/New_York");
    expect(result?.toISOString()).toBe("2025-03-04T14:00:00.000Z");
  });

  it("accounts for daylight saving in summer", () => {
    // 2025-07-04 is EDT (UTC-4).
    const result = wallClockToUtc("2025-07-04", "09:00", "America/New_York");
    expect(result?.toISOString()).toBe("2025-07-04T13:00:00.000Z");
  });

  it("handles a zone that does not observe daylight saving", () => {
    // Phoenix stays at UTC-7 all year.
    const winter = wallClockToUtc("2025-01-15", "08:00", "America/Phoenix");
    const summer = wallClockToUtc("2025-07-15", "08:00", "America/Phoenix");
    expect(winter?.toISOString()).toBe("2025-01-15T15:00:00.000Z");
    expect(summer?.toISOString()).toBe("2025-07-15T15:00:00.000Z");
  });

  it("rejects a wall-clock time that does not exist because of a DST jump", () => {
    // Clocks skip from 02:00 to 03:00 in New York on 2025-03-09.
    expect(wallClockToUtc("2025-03-09", "02:30", "America/New_York")).toBeNull();
  });

  it("rejects malformed input instead of guessing", () => {
    expect(wallClockToUtc("03/04/2025", "09:00", "America/New_York")).toBeNull();
    expect(wallClockToUtc("2025-03-04", "9:00", "America/New_York")).toBeNull();
    expect(wallClockToUtc("2025-03-04", "09:00", "Nowhere/Special")).toBeNull();
  });
});

describe("display formatting", () => {
  it("renders a stored UTC instant in the service location's zone, not the viewer's", () => {
    const instant = new Date("2025-03-04T14:00:00.000Z");
    expect(formatInTimeZone(instant, "America/New_York", "yyyy-MM-dd HH:mm")).toBe(
      "2025-03-04 09:00",
    );
    expect(formatInTimeZone(instant, "America/Los_Angeles", "yyyy-MM-dd HH:mm")).toBe(
      "2025-03-04 06:00",
    );
  });

  it("labels the zone, and distinguishes standard from daylight time", () => {
    expect(shortTimeZoneName(new Date("2025-03-04T14:00:00.000Z"), "America/New_York")).toBe("EST");
    expect(shortTimeZoneName(new Date("2025-07-04T13:00:00.000Z"), "America/New_York")).toBe("EDT");
  });

  it("produces a readable appointment string", () => {
    const instant = new Date("2025-03-04T14:00:00.000Z");
    expect(formatAppointmentTime(instant, "America/New_York")).toBe(
      "Tue, Mar 4, 2025 at 9:00 AM (EST)",
    );
  });

  it("round-trips a wall-clock time through storage and back", () => {
    const stored = wallClockToUtc("2025-11-02", "10:30", "America/Chicago");
    expect(stored).not.toBeNull();
    expect(formatInTimeZone(stored as Date, "America/Chicago", "HH:mm")).toBe("10:30");
  });
});
