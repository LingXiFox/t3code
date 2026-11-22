import type { ContextWindowSnapshot } from "@t3tools/client-runtime/state/context-window";
import { describe, expect, it } from "vite-plus/test";

import { deriveThreadMetrics } from "./contextCacheMetrics";

function makeContextWindow(overrides: Partial<ContextWindowSnapshot> = {}): ContextWindowSnapshot {
  return {
    usedTokens: 40_000,
    totalProcessedTokens: 120_000,
    maxTokens: 200_000,
    remainingTokens: 160_000,
    usedPercentage: 20,
    remainingPercentage: 80,
    inputTokens: null,
    cachedInputTokens: null,
    outputTokens: null,
    reasoningOutputTokens: null,
    lastUsedTokens: null,
    lastInputTokens: null,
    lastCachedInputTokens: null,
    lastOutputTokens: null,
    lastReasoningOutputTokens: null,
    toolUses: 3,
    durationMs: 2_500,
    compactsAutomatically: true,
    autoCompactThreshold: 180_000,
    cost: { amount: 0.12, currency: "USD" },
    updatedAt: "2026-11-22T12:00:00.000Z",
    ...overrides,
  };
}

describe("deriveThreadMetrics", () => {
  it("keeps Context Window and Prompt Cache strictly separated and computes last-turn & weighted session hit rates", () => {
    const metrics = deriveThreadMetrics({
      modelName: "Claude Sonnet 4.5",
      modelId: "claude-sonnet-4-5",
      providerDriver: "claudeAgent",
      contextWindow: makeContextWindow({ usedTokens: 50_000, maxTokens: 200_000 }),
      activeProviderThreadId: "pt-1",
      providerTurns: [
        {
          providerThreadId: "pt-1",
          turnTokenUsage: {
            usageScope: "main_agent",
            usageStatus: "complete",
            inputTokens: 10_000,
            cachedInputTokens: 6_000,
            cacheCreationTokens: 2_000,
            outputTokens: 500,
            hasSubagents: false,
          },
        },
        {
          providerThreadId: "pt-1",
          turnTokenUsage: {
            usageScope: "main_agent",
            usageStatus: "complete",
            inputTokens: 20_000,
            cachedInputTokens: 18_000,
            cacheCreationTokens: 0,
            outputTokens: 800,
            hasSubagents: false,
          },
        },
        // Retired provider thread turn must be ignored
        {
          providerThreadId: "pt-old",
          turnTokenUsage: {
            usageScope: "main_agent",
            usageStatus: "complete",
            inputTokens: 99_000,
            cachedInputTokens: 0,
            outputTokens: 100,
            hasSubagents: false,
          },
        },
      ],
      items: [
        { type: "command_execution", status: "completed", providerThreadId: "pt-1" },
        { type: "file_change", status: "completed", providerThreadId: "pt-1" },
        { type: "compaction", status: "completed", providerThreadId: "pt-1" },
      ],
      turnCount: 2,
      isWorking: false,
      isCompacting: false,
      hasError: false,
    });

    // Context used must never subtract cacheRead
    expect(metrics.context.status).toBe("available");
    expect(metrics.context.usedTokens).toBe(50_000);
    expect(metrics.context.remainingTokens).toBe(150_000);
    expect(metrics.context.usedPercent).toBe(25);
    expect(metrics.context.compactionState).toBe("compacted");

    // Cache metrics: Turn 1 (6k read / 2k write / 2k uncached = 10k) + Turn 2 (18k read / 0 write / 2k uncached = 20k)
    expect(metrics.cache.status).toBe("available");
    expect(metrics.cache.cacheReadTokens).toBe(24_000);
    expect(metrics.cache.cacheWriteTokens).toBe(2_000);
    expect(metrics.cache.uncachedInputTokens).toBe(4_000);
    expect(metrics.cache.totalInputTokens).toBe(30_000);
    expect(metrics.cache.lastTurnHitRate).toBeCloseTo(0.9, 6);
    expect(metrics.cache.sessionHitRate).toBeCloseTo(0.8, 6);

    // Runtime stats
    expect(metrics.runtime.turnCount).toBe(2);
    expect(metrics.runtime.toolCallCount).toBe(2);
    expect(metrics.runtime.runStatus).toBe("idle");
    expect(metrics.runtime.lastTurnDurationMs).toBe(2_500);
  });

  it("reports unavailable cache metrics when provider omits cache fields and handles missing maxTokens cleanly", () => {
    const metrics = deriveThreadMetrics({
      modelName: "GPT-6 Astra",
      modelId: "gpt-6-astra",
      providerDriver: "codex",
      contextWindow: makeContextWindow({
        usedTokens: 12_000,
        maxTokens: null,
        remainingTokens: null,
        usedPercentage: null,
        remainingPercentage: null,
      }),
      activeProviderThreadId: null,
      providerTurns: [
        {
          providerThreadId: null,
          turnTokenUsage: {
            usageScope: "main_agent",
            usageStatus: "complete",
            inputTokens: 12_000,
            outputTokens: 400,
            hasSubagents: false,
          },
        },
      ],
      items: [],
      turnCount: 1,
      isWorking: true,
      isCompacting: false,
      hasError: false,
    });

    expect(metrics.context.status).toBe("partial");
    expect(metrics.context.usedPercent).toBeNull();
    expect(metrics.cache.status).toBe("unavailable");
    expect(metrics.cache.sessionHitRate).toBeNull();
    expect(metrics.runtime.runStatus).toBe("running");
  });
});
