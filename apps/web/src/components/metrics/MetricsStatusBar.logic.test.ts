import { describe, expect, it } from "vite-plus/test";

import {
  formatCompactTokens,
  formatDurationCompact,
  formatPercent,
  formatResetCountdown,
  lowestRemainingWindow,
  quotaBarTone,
  shortPlatformName,
  statusBadgeTone,
} from "./MetricsStatusBar.logic";

describe("MetricsStatusBar.logic", () => {
  it("formats compact tokens, percentages, durations, and reset countdowns", () => {
    expect(formatCompactTokens(null)).toBe("--");
    expect(formatCompactTokens(850)).toBe("850");
    expect(formatCompactTokens(42_500)).toBe("42.5k");
    expect(formatCompactTokens(1_500_000)).toBe("1.5M");

    expect(formatPercent(null)).toBe("--");
    expect(formatPercent(78.6)).toBe("79%");

    expect(formatDurationCompact(650)).toBe("650ms");
    expect(formatDurationCompact(2_400)).toBe("2.4s");
    expect(formatDurationCompact(95_000)).toBe("1m 35s");

    const nowMs = Date.parse("2026-11-22T12:00:00.000Z");
    expect(formatResetCountdown("2026-11-22T14:30:00.000Z", nowMs)).toBe("2h 30m");
    expect(formatResetCountdown("2026-11-24T12:00:00.000Z", nowMs)).toBe("2d");
  });

  it("picks lowest remaining window and maps tones and short names", () => {
    const lowest = lowestRemainingWindow([
      {
        id: "w1",
        poolName: "5h",
        label: "5h",
        windowKind: "5h",
        windowDurationMins: 300,
        unit: "percent",
        usedPercent: 25,
        remainingPercent: 75,
        usedAmount: null,
        limitAmount: null,
        resetAt: null,
        modelIds: null,
        pace: null,
      },
      {
        id: "w2",
        poolName: "Weekly",
        label: "Weekly",
        windowKind: "weekly",
        windowDurationMins: 10080,
        unit: "percent",
        usedPercent: 88,
        remainingPercent: 12,
        usedAmount: null,
        limitAmount: null,
        resetAt: null,
        modelIds: null,
        pace: null,
      },
    ]);
    expect(lowest?.id).toBe("w2");
    expect(quotaBarTone(8)).toBe("error");
    expect(quotaBarTone(15)).toBe("warning");
    expect(quotaBarTone(65)).toBe("normal");
    expect(shortPlatformName("antigravity")).toBe("Antigravity");
    expect(statusBadgeTone("stale")).toBe("warning");
    expect(statusBadgeTone("unauthorized")).toBe("error");
  });
});
