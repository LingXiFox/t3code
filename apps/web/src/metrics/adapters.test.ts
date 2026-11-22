import {
  EnvironmentId,
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerProvider,
} from "@t3tools/contracts";
import type { LimitPresentations } from "@t3tools/shared/usageLimits";
import { describe, expect, it, vi } from "vite-plus/test";

import { collectUnifiedQuotaMetrics, QUOTA_PLATFORM_ADAPTERS } from "./adapters";
import { formatSafeAccountAlias } from "./adapters/shared";
import { QUOTA_PLATFORM_ORDER } from "./types";

const ENV_ID = EnvironmentId.make("env-1");
const NOW_MS = Date.parse("2026-11-22T12:00:00.000Z");

function makeProvider(driver: string, overrides: Partial<ServerProvider> = {}): ServerProvider {
  return {
    instanceId: ProviderInstanceId.make(`${driver}-1`),
    driver: ProviderDriverKind.make(driver),
    displayName: driver,
    enabled: true,
    installed: true,
    accentColor: "#ffffff",
    auth: {
      status: "authenticated",
      email: "alice.lingxi@example.com",
      label: "Pro",
    },
    models: [],
    capabilities: {
      sessionModelSwitch: "in-session",
      supportsCustomModel: false,
      supportsFastMode: false,
      supportsEffort: false,
    },
    ...overrides,
  } as ServerProvider;
}

function makePresentations(providers: readonly ServerProvider[]): LimitPresentations {
  return new Map([
    [
      ENV_ID,
      {
        entry: { target: { label: "Local Mac" } },
        serverConfig: {
          providers,
          usageLimitSources: [],
        },
      },
    ],
  ]);
}

describe("Unified Quota Platform Adapters", () => {
  it("masks email aliases safely without exposing full local parts", () => {
    expect(formatSafeAccountAlias({ email: "alice.lingxi@example.com", fallback: "Codex" })).toBe(
      "al***@example.com",
    );
    expect(formatSafeAccountAlias({ email: "ab@x.com", fallback: "Codex" })).toBe("a*@x.com");
    expect(formatSafeAccountAlias({ displayName: "Workspace", fallback: "Codex" })).toBe(
      "Workspace",
    );
  });

  it("normalizes Codex multi-window quotas and Claude scoped / zero-spend-cap states", () => {
    const presentations = makePresentations([
      makeProvider("codex", {
        usageLimits: {
          checkedAt: "2026-11-22T11:55:00.000Z",
          windows: [
            {
              id: "primary",
              kind: "session",
              label: "Session",
              usedPercent: 25,
              windowDurationMins: 300,
              resetsAt: "2026-11-22T16:00:00.000Z",
            },
            {
              id: "secondary",
              kind: "weekly",
              label: "Weekly",
              usedPercent: 60,
              windowDurationMins: 10080,
              resetsAt: "2026-11-28T00:00:00.000Z",
            },
          ],
        },
      }),
      makeProvider("claudeAgent", {
        usageLimits: {
          checkedAt: "2026-11-22T11:58:00.000Z",
          windows: [
            {
              id: "five_hour",
              kind: "session",
              label: "Session",
              usedPercent: 10,
              windowDurationMins: 300,
            },
            {
              id: "seven_day_sonnet",
              kind: "weekly",
              label: "Weekly · Sonnet",
              usedPercent: 40,
              windowDurationMins: 10080,
            },
          ],
        },
      }),
    ]);

    const results = collectUnifiedQuotaMetrics({
      presentations,
      nowMs: NOW_MS,
      order: ["codex", "claude"],
    });

    expect(results[0]?.status).toBe("available");
    expect(results[0]?.accounts[0]?.safeAlias).toBe("al***@example.com");
    expect(results[0]?.windows.map((w) => [w.poolName, w.windowKind, w.remainingPercent])).toEqual([
      ["Codex 5h", "5h", 75],
      ["Codex Weekly", "weekly", 40],
    ]);

    expect(results[1]?.status).toBe("available");
    expect(results[1]?.windows.map((w) => [w.poolName, w.remainingPercent])).toEqual([
      ["Claude 5h", 90],
      ["Weekly · Sonnet", 60],
    ]);
  });

  it("handles Antigravity multi-model pools (Gemini sorted first), Cursor deduplication, Grok API mode, and Muse awaiting session", () => {
    const presentations = makePresentations([
      makeProvider("antigravity", {
        usageLimits: {
          checkedAt: "2026-11-22T11:50:00.000Z",
          windows: [
            {
              id: "claude-5h",
              kind: "session",
              label: "Claude · 5h",
              usedPercent: 20,
              windowDurationMins: 300,
              modelIds: ["claude-sonnet-4-5"],
            },
            {
              id: "gemini-pro-5h",
              kind: "session",
              label: "Gemini Pro · 5h",
              usedPercent: 35,
              windowDurationMins: 300,
              modelIds: ["gemini-3-pro"],
            },
          ],
        },
      }),
      makeProvider("cursor", {
        usageLimits: {
          checkedAt: "2026-11-22T11:50:00.000Z",
          windows: [
            { id: "totalPercentUsed", kind: "monthly", label: "Overall", usedPercent: 50 },
            { id: "autoPercentUsed", kind: "monthly", label: "Cursor Models", usedPercent: 30 },
            { id: "apiPercentUsed", kind: "monthly", label: "Other Models", usedPercent: 70 },
          ],
        },
      }),
      makeProvider("grok", {
        usageLimits: {
          checkedAt: "2026-11-22T11:50:00.000Z",
          windows: [],
          unavailable: { reason: "unsupported" },
        },
      }),
      makeProvider("muse", {
        usageLimits: undefined,
      }),
    ]);

    const results = collectUnifiedQuotaMetrics({
      presentations,
      nowMs: NOW_MS,
      order: ["antigravity", "cursor", "grok", "muse"],
    });

    // Antigravity sorts Gemini pool first and preserves modelIds
    expect(results[0]?.windows.map((w) => w.id)).toEqual(["gemini-pro-5h", "claude-5h"]);
    expect(results[0]?.windows[0]?.modelIds).toEqual(["gemini-3-pro"]);

    // Cursor hides redundant total when auto + api are both present
    expect(results[1]?.windows.map((w) => w.poolName)).toEqual(["Cursor Models", "Other Models"]);

    // Grok API-key mode explains token-only behavior honestly
    expect(results[2]?.status).toBe("unavailable");
    expect(results[2]?.reason).toContain("API-key mode");

    // Muse reports awaiting live session event honestly
    expect(results[3]?.status).toBe("unavailable");
    expect(results[3]?.reason).toContain("live session");
  });

  it("marks stale snapshots, unauthorized accounts, and isolates throwing adapters", () => {
    const staleCheckedAt = "2026-11-22T10:00:00.000Z";
    const presentations = makePresentations([
      makeProvider("codex", {
        usageLimits: {
          checkedAt: staleCheckedAt,
          windows: [{ id: "primary", kind: "session", label: "Session", usedPercent: 10 }],
        },
      }),
      makeProvider("claudeAgent", {
        auth: { status: "unauthenticated" },
        usageLimits: undefined,
      }),
    ]);

    const spy = vi.spyOn(QUOTA_PLATFORM_ADAPTERS.cursor, "collect").mockImplementation(() => {
      throw new Error("Unexpected cursor adapter boom");
    });
    try {
      const results = collectUnifiedQuotaMetrics({
        presentations,
        nowMs: NOW_MS,
        order: QUOTA_PLATFORM_ORDER,
      });

      const codex = results.find((r) => r.platformId === "codex");
      const claude = results.find((r) => r.platformId === "claude");
      const cursor = results.find((r) => r.platformId === "cursor");

      expect(codex?.status).toBe("stale");
      expect(codex?.stale).toBe(true);
      expect(claude?.status).toBe("unauthorized");
      expect(cursor?.status).toBe("error");
      expect(cursor?.errorMessage).toBe("Unexpected cursor adapter boom");
    } finally {
      spy.mockRestore();
    }
  });
});
