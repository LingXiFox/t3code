import { describe, expect, it } from "vite-plus/test";

import { DEFAULT_METRICS_PREFERENCES, sanitizeMetricsPreferences } from "./preferences";
import { QUOTA_PLATFORM_ORDER } from "./types";

describe("metrics preferences", () => {
  it("falls back to defaults on invalid payloads", () => {
    expect(sanitizeMetricsPreferences(null)).toEqual(DEFAULT_METRICS_PREFERENCES);
    expect(sanitizeMetricsPreferences("bad")).toEqual(DEFAULT_METRICS_PREFERENCES);
  });

  it("preserves custom platform ordering, filtering, visibility, and autoRefresh while appending new platforms", () => {
    const sanitized = sanitizeMetricsPreferences({
      visible: false,
      autoRefresh: false,
      platformOrder: ["antigravity", "claude", "unknown-id", "antigravity"],
      enabledPlatforms: ["claude", "codex", "bogus"],
    });

    expect(sanitized.visible).toBe(false);
    expect(sanitized.autoRefresh).toBe(false);
    expect(sanitized.platformOrder).toEqual([
      "antigravity",
      "claude",
      "codex",
      "cursor",
      "grok",
      "muse",
    ]);
    expect(sanitized.enabledPlatforms).toEqual(["claude", "codex"]);
    expect(sanitized.platformOrder).toHaveLength(QUOTA_PLATFORM_ORDER.length);
  });
});
