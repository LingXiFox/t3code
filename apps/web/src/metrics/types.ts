import type { ProviderDriverKind, ServerProviderUsageWindow } from "@t3tools/contracts";

export type QuotaPlatformId = "codex" | "claude" | "antigravity" | "cursor" | "grok" | "muse";

export const QUOTA_PLATFORM_ORDER: readonly QuotaPlatformId[] = [
  "codex",
  "claude",
  "antigravity",
  "cursor",
  "grok",
  "muse",
];

export type QuotaStatus =
  | "available"
  | "partial"
  | "stale"
  | "unavailable"
  | "unauthorized"
  | "error";

export type QuotaUnit = "percent" | "tokens" | "requests" | "credits" | "currency";

export type QuotaWindowKind = "5h" | "daily" | "weekly" | "monthly" | "custom";

export interface QuotaPoolWindow {
  readonly id: string;
  readonly poolName: string;
  readonly label: string;
  readonly windowKind: QuotaWindowKind;
  readonly windowDurationMins: number | null;
  readonly unit: QuotaUnit;
  readonly usedPercent: number | null;
  readonly remainingPercent: number | null;
  readonly usedAmount: number | null;
  readonly limitAmount: number | null;
  readonly resetAt: string | null;
  readonly modelIds: readonly string[] | null;
  readonly pace: "ahead" | "on" | "under" | null;
  readonly raw?: ServerProviderUsageWindow;
}

export interface QuotaAccountSummary {
  readonly accountKey: string;
  readonly safeAlias: string;
  readonly plan: string | null;
  readonly environmentLabels: readonly string[];
  readonly sourceLabel: string | null;
}

export interface QuotaPlatformSnapshot {
  readonly platformId: QuotaPlatformId;
  readonly platformName: string;
  readonly driverKind: ProviderDriverKind;
  readonly accentColor: string;
  readonly status: QuotaStatus;
  readonly accounts: readonly QuotaAccountSummary[];
  readonly windows: readonly QuotaPoolWindow[];
  readonly source: string;
  readonly updatedAt: string | null;
  readonly stale: boolean;
  readonly reason: string | null;
  readonly errorMessage: string | null;
  readonly externalUsageUrl: string | null;
  readonly raw?: unknown;
}

export type ContextCompactionState = "idle" | "compacting" | "compacted" | "failed" | "unknown";

export interface ContextMetricsSnapshot {
  readonly status: "available" | "partial" | "unavailable";
  readonly modelName: string | null;
  readonly modelId: string | null;
  readonly providerDriver: string | null;
  readonly contextWindowTokens: number | null;
  readonly usedTokens: number | null;
  readonly remainingTokens: number | null;
  readonly usedPercent: number | null;
  readonly compactionState: ContextCompactionState;
  readonly autoCompactThreshold: number | null;
  readonly compactsAutomatically: boolean | null;
  readonly isEstimated: boolean;
  readonly updatedAt: string | null;
}

export interface CacheTurnBreakdown {
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
  readonly uncachedInputTokens: number;
  readonly totalInputTokens: number;
}

export interface CacheMetricsSnapshot {
  readonly status: "available" | "partial" | "unavailable";
  readonly cacheReadTokens: number | null;
  readonly cacheWriteTokens: number | null;
  readonly uncachedInputTokens: number | null;
  readonly totalInputTokens: number | null;
  readonly lastTurnHitRate: number | null;
  readonly sessionHitRate: number | null;
  readonly denominatorDefinition: string;
  readonly lastTurn: CacheTurnBreakdown | null;
  readonly providerNote: string | null;
}

export type AgentRunStatus = "idle" | "running" | "compacting" | "waiting" | "error";

export interface AgentRuntimeSnapshot {
  readonly turnCount: number;
  readonly toolCallCount: number;
  readonly runStatus: AgentRunStatus;
  readonly lastTurnDurationMs: number | null;
  readonly totalInputTokens: number | null;
  readonly totalOutputTokens: number | null;
  readonly reasoningTokens: number | null;
  readonly cost: { readonly amount: number; readonly currency: string } | null;
}
