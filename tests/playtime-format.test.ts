import { describe, expect, it } from "vitest";
import { formatPlaytimeHours, sanitizeDisplayedPlaytime } from "../src/playtime-format.js";

describe("playtime formatting", () => {
  it("renders the first-use value as 0 h 00", () => {
    expect(formatPlaytimeHours(0)).toBe("0 h 00");
    expect(formatPlaytimeHours(59)).toBe("0 h 00");
  });

  it("renders two hours and seven minutes", () => {
    expect(formatPlaytimeHours(2 * 3600 + 7 * 60)).toBe("2 h 07");
    expect(formatPlaytimeHours(2 * 3600 + 7 * 60 + 59)).toBe("2 h 07");
  });

  it("renders durations above 100 hours without wrapping", () => {
    expect(formatPlaytimeHours(128 * 3600 + 42 * 60)).toBe("128 h 42");
  });

  it("never formats a negative or non-finite value", () => {
    expect(formatPlaytimeHours(-12)).toBe("0 h 00");
    expect(formatPlaytimeHours(Number.NaN)).toBe("0 h 00");
    expect(formatPlaytimeHours(Number.POSITIVE_INFINITY)).toBe("0 h 00");
    expect(sanitizeDisplayedPlaytime(-4)).toBe(0);
  });
});
