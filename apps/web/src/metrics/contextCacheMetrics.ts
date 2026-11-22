import {
  isToolLifecycleItemType,
  type OrchestrationV2ProviderTurnTokenUsage,
  type TurnTokenUsage,
} from "@t3tools/contracts";
import type { ContextWindowSnapshot } from "@t3tools/client-runtime/state/context-window";
import * as DateTime from "effect/DateTime";

import type {
  AgentRunStatus,
  AgentRuntimeSnapshot,
  CacheMetricsSnapshot,
  CacheTurnBreakdown,
  ContextCompactionState,
  ContextMetricsSnapshot,
} from "./types";

export interface MetricsProviderTurnLike {
  readonly providerThreadId?: string | null | undefined;
  readonly tokenUsage?: OrchestrationV2ProviderTurnTokenUsage | null | undefined;
  readonly turnTokenUsage?: TurnTokenUsage | null | undefined;
  readonly startedAt?: DateTime.Utc | string | null | undefined;
  readonly completedAt?: DateTime.Utc | string | null | undefined;
}

export interface MetricsTurnItemLike {
  readonly type: string;
  readonly status?: string | undefined;
  readonly providerThreadId?: string | null | undefined;
}

export interface DeriveThreadMetricsInput {
  readonly modelName: string | null;
  readonly modelId: string | null;
  readonly providerDriver: string | null;
  readonly contextWindow: ContextWindowSnapshot | null;
  readonly providerTurns: readonly MetricsProviderTurnLike[];
  readonly activeProviderThreadId: string | null;
  readonly items: readonly MetricsTurnItemLike[];
  readonly turnCount: number;
  readonly isWorking: boolean;
  readonly isCompacting: boolean;
  readonly hasError: boolean;
}

export interface DerivedThreadMetrics {
  readonly context: ContextMetricsSnapshot;
  readonly cache: CacheMetricsSnapshot;
  readonly runtime: AgentRuntimeSnapshot;
}

const CACHE_DENOMINATOR_DEF = "cacheRead / (uncachedInput + cacheRead + cacheWrite)";

function finiteNonNegative(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function deriveCompactionState(
  items: readonly MetricsTurnItemLike[],
  isCompacting: boolean,
  activeProviderThreadId: string | null,
): ContextCompactionState {
  if (isCompacting) return "compacting";
  for (let i = items.length - 1; i >= 0; i -= 1) {
    const item = items[i];
    if (!item || item.type !== "compaction") continue;
    if (
      activeProviderThreadId &&
      item.providerThreadId &&
      item.providerThreadId !== activeProviderThreadId
    ) {
      continue;
    }
    if (item.status === "inProgress") return "compacting";
    if (item.status === "completed") return "compacted";
    if (item.status === "failed") return "failed";
  }
  return "idle";
}

function deriveTurnCacheBreakdown(usage: TurnTokenUsage): CacheTurnBreakdown | null {
  if (usage.usageStatus === "unavailable") return null;
  const hasCacheRead = usage.cachedInputTokens !== undefined;
  const hasCacheWrite = usage.cacheCreationTokens !== undefined;
  if (!hasCacheRead && !hasCacheWrite) return null;

  const cacheReadTokens = finiteNonNegative(usage.cachedInputTokens) ?? 0;
  const cacheWriteTokens = finiteNonNegative(usage.cacheCreationTokens) ?? 0;
  const rawInput = finiteNonNegative(usage.inputTokens);
  // Contract: TurnTokenUsage.inputTokens already includes cache reads and writes.
  const uncachedInputTokens =
    rawInput !== null ? Math.max(0, rawInput - cacheReadTokens - cacheWriteTokens) : 0;
  const totalInputTokens =
    rawInput !== null
      ? Math.max(rawInput, uncachedInputTokens + cacheReadTokens + cacheWriteTokens)
      : cacheReadTokens + cacheWriteTokens;

  return {
    cacheReadTokens,
    cacheWriteTokens,
    uncachedInputTokens,
    totalInputTokens,
  };
}

function deriveSnapshotFallbackBreakdown(
  contextWindow: ContextWindowSnapshot | null,
  activeTurns: readonly MetricsProviderTurnLike[],
): { readonly lastTurn: CacheTurnBreakdown | null; readonly session: CacheTurnBreakdown | null } {
  const latestTurnUsage = [...activeTurns].reverse().find((t) => t.tokenUsage != null)?.tokenUsage;
  const lastRead = finiteNonNegative(
    contextWindow?.lastCachedInputTokens ?? latestTurnUsage?.cachedInputTokens,
  );
  const lastInput = finiteNonNegative(
    contextWindow?.lastInputTokens ?? latestTurnUsage?.inputTokens,
  );
  const lastTurn =
    lastRead !== null && lastInput !== null
      ? {
          cacheReadTokens: lastRead,
          cacheWriteTokens: 0,
          uncachedInputTokens: Math.max(0, lastInput - lastRead),
          totalInputTokens: Math.max(lastInput, lastRead),
        }
      : null;

  const totalRead = finiteNonNegative(contextWindow?.cachedInputTokens);
  const totalInput = finiteNonNegative(contextWindow?.inputTokens);
  const session =
    totalRead !== null && totalInput !== null
      ? {
          cacheReadTokens: totalRead,
          cacheWriteTokens: 0,
          uncachedInputTokens: Math.max(0, totalInput - totalRead),
          totalInputTokens: Math.max(totalInput, totalRead),
        }
      : lastTurn;

  return { lastTurn, session };
}

function computeHitRate(breakdown: CacheTurnBreakdown | null): number | null {
  if (!breakdown || breakdown.totalInputTokens <= 0) return null;
  return breakdown.cacheReadTokens / breakdown.totalInputTokens;
}

export function deriveThreadMetrics(input: DeriveThreadMetricsInput): DerivedThreadMetrics {
  const cw = input.contextWindow;
  const compactionState = deriveCompactionState(
    input.items,
    input.isCompacting,
    input.activeProviderThreadId,
  );

  const usedTokens = finiteNonNegative(cw?.usedTokens);
  const maxTokens = finiteNonNegative(cw?.maxTokens);
  const remainingTokens =
    usedTokens !== null && maxTokens !== null && maxTokens > 0
      ? Math.max(0, Math.round(maxTokens - usedTokens))
      : finiteNonNegative(cw?.remainingTokens);
  const usedPercent =
    usedTokens !== null && maxTokens !== null && maxTokens > 0
      ? Math.min(100, (usedTokens / maxTokens) * 100)
      : cw?.usedPercentage !== null &&
          cw?.usedPercentage !== undefined &&
          Number.isFinite(cw.usedPercentage)
        ? Math.min(100, Math.max(0, cw.usedPercentage))
        : null;

  const context: ContextMetricsSnapshot = {
    status:
      usedTokens === null
        ? "unavailable"
        : maxTokens !== null && maxTokens > 0
          ? "available"
          : "partial",
    modelName: input.modelName,
    modelId: input.modelId,
    providerDriver: input.providerDriver,
    contextWindowTokens: maxTokens,
    usedTokens,
    remainingTokens,
    usedPercent,
    compactionState,
    autoCompactThreshold: finiteNonNegative(cw?.autoCompactThreshold),
    compactsAutomatically: cw?.compactsAutomatically ?? null,
    isEstimated: false,
    updatedAt: cw?.updatedAt ?? null,
  };

  const activeTurns = input.activeProviderThreadId
    ? input.providerTurns.filter(
        (turn) => !turn.providerThreadId || turn.providerThreadId === input.activeProviderThreadId,
      )
    : input.providerTurns;

  const turnBreakdowns = activeTurns
    .map((turn) => (turn.turnTokenUsage ? deriveTurnCacheBreakdown(turn.turnTokenUsage) : null))
    .filter((entry): entry is CacheTurnBreakdown => entry !== null);

  let cache: CacheMetricsSnapshot;
  if (turnBreakdowns.length > 0) {
    const lastTurn = turnBreakdowns[turnBreakdowns.length - 1] ?? null;
    const sumRead = turnBreakdowns.reduce((acc, b) => acc + b.cacheReadTokens, 0);
    const sumWrite = turnBreakdowns.reduce((acc, b) => acc + b.cacheWriteTokens, 0);
    const sumUncached = turnBreakdowns.reduce((acc, b) => acc + b.uncachedInputTokens, 0);
    const sumTotal = turnBreakdowns.reduce((acc, b) => acc + b.totalInputTokens, 0);
    const sessionHitRate = sumTotal > 0 ? sumRead / sumTotal : null;
    const lastTurnHitRate = computeHitRate(lastTurn);

    cache = {
      status: sessionHitRate !== null ? "available" : "partial",
      cacheReadTokens: sumRead,
      cacheWriteTokens: sumWrite,
      uncachedInputTokens: sumUncached,
      totalInputTokens: sumTotal,
      lastTurnHitRate,
      sessionHitRate,
      denominatorDefinition: CACHE_DENOMINATOR_DEF,
      lastTurn,
      providerNote: null,
    };
  } else {
    const fallback = deriveSnapshotFallbackBreakdown(cw, activeTurns);
    if (fallback.session) {
      cache = {
        status: "partial",
        cacheReadTokens: fallback.session.cacheReadTokens,
        cacheWriteTokens: null,
        uncachedInputTokens: fallback.session.uncachedInputTokens,
        totalInputTokens: fallback.session.totalInputTokens,
        lastTurnHitRate: computeHitRate(fallback.lastTurn),
        sessionHitRate: computeHitRate(fallback.session),
        denominatorDefinition: CACHE_DENOMINATOR_DEF,
        lastTurn: fallback.lastTurn,
        providerNote: "Derived from context snapshot; cache write breakdown not reported.",
      };
    } else {
      cache = {
        status: "unavailable",
        cacheReadTokens: null,
        cacheWriteTokens: null,
        uncachedInputTokens: null,
        totalInputTokens: null,
        lastTurnHitRate: null,
        sessionHitRate: null,
        denominatorDefinition: CACHE_DENOMINATOR_DEF,
        lastTurn: null,
        providerNote: "Active provider/session has not reported prompt cache counters.",
      };
    }
  }

  let toolCallCount = 0;
  for (const item of input.items) {
    if (
      input.activeProviderThreadId &&
      item.providerThreadId &&
      item.providerThreadId !== input.activeProviderThreadId
    ) {
      continue;
    }
    if (isToolLifecycleItemType(item.type)) {
      toolCallCount += 1;
    }
  }
  if (toolCallCount === 0 && cw?.toolUses !== null && cw?.toolUses !== undefined) {
    toolCallCount = cw.toolUses;
  }

  const runStatus: AgentRunStatus = input.isCompacting
    ? "compacting"
    : input.isWorking
      ? "running"
      : input.hasError
        ? "error"
        : "idle";

  let lastTurnDurationMs = finiteNonNegative(cw?.durationMs);
  if (lastTurnDurationMs === null) {
    for (let i = activeTurns.length - 1; i >= 0; i -= 1) {
      const turn = activeTurns[i];
      if (!turn?.startedAt || !turn.completedAt) continue;
      const start =
        typeof turn.startedAt === "string"
          ? Date.parse(turn.startedAt)
          : DateTime.toEpochMillis(turn.startedAt);
      const end =
        typeof turn.completedAt === "string"
          ? Date.parse(turn.completedAt)
          : DateTime.toEpochMillis(turn.completedAt);
      if (Number.isFinite(start) && Number.isFinite(end) && end >= start) {
        lastTurnDurationMs = Math.round(end - start);
        break;
      }
    }
  }

  const runtime: AgentRuntimeSnapshot = {
    turnCount: Math.max(input.turnCount, activeTurns.length),
    toolCallCount,
    runStatus,
    lastTurnDurationMs,
    totalInputTokens: finiteNonNegative(cw?.inputTokens) ?? cache.totalInputTokens,
    totalOutputTokens: finiteNonNegative(cw?.outputTokens),
    reasoningTokens: finiteNonNegative(cw?.reasoningOutputTokens),
    cost: cw?.cost ?? null,
  };

  return { context, cache, runtime };
}
