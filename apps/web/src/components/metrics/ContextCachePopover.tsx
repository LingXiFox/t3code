import { useGT } from "gt-react";

import type {
  AgentRuntimeSnapshot,
  CacheMetricsSnapshot,
  ContextMetricsSnapshot,
} from "../../metrics/types";
import { cn } from "../../lib/utils";
import {
  formatCompactTokens,
  formatDurationCompact,
  formatPercent,
} from "./MetricsStatusBar.logic";

export function ContextCachePopover({
  context,
  cache,
  runtime,
}: {
  readonly context: ContextMetricsSnapshot;
  readonly cache: CacheMetricsSnapshot;
  readonly runtime: AgentRuntimeSnapshot;
}) {
  const gt = useGT();

  const ctxPercent = context.usedPercent !== null ? Math.round(context.usedPercent) : 0;
  const ctxTone = ctxPercent >= 90 ? "error" : ctxPercent >= 80 ? "warning" : "normal";

  const cacheTotal = cache.totalInputTokens ?? 0;
  const cacheReadPct =
    cacheTotal > 0 && cache.cacheReadTokens !== null
      ? (cache.cacheReadTokens / cacheTotal) * 100
      : 0;
  const cacheWritePct =
    cacheTotal > 0 && cache.cacheWriteTokens !== null
      ? (cache.cacheWriteTokens / cacheTotal) * 100
      : 0;
  const uncachedPct =
    cacheTotal > 0 && cache.uncachedInputTokens !== null
      ? (cache.uncachedInputTokens / cacheTotal) * 100
      : 0;

  return (
    <div
      data-metrics-panel="context-cache"
      className="flex w-[min(92vw,420px)] flex-col gap-3.5 p-1 text-xs text-foreground"
    >
      {/* Section 1: Context Window */}
      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="font-semibold">{gt("Context Window")}</div>
            <div className="truncate text-2xs text-muted-foreground">
              {context.modelName ?? gt("No active model")}
            </div>
          </div>
          <span className="rounded-full bg-muted px-2 py-0.5 text-3xs font-medium capitalize text-muted-foreground">
            {context.compactionState}
          </span>
        </div>

        <div className="h-2 w-full overflow-hidden rounded-full bg-muted/70">
          <div
            className={cn(
              "h-full rounded-full transition-[width] duration-300 motion-reduce:transition-none",
              ctxTone === "error"
                ? "bg-error"
                : ctxTone === "warning"
                  ? "bg-warning"
                  : "bg-primary",
            )}
            style={{ width: `${context.usedPercent !== null ? ctxPercent : 0}%` }}
          />
        </div>

        <div className="grid grid-cols-3 gap-2 rounded-lg border border-border/50 bg-card/50 p-2 font-mono text-2xs tabular-nums">
          <div>
            <div className="font-sans text-3xs text-muted-foreground">{gt("Context Used")}</div>
            <div>{formatCompactTokens(context.usedTokens)}</div>
          </div>
          <div>
            <div className="font-sans text-3xs text-muted-foreground">{gt("Context Free")}</div>
            <div>{formatCompactTokens(context.remainingTokens)}</div>
          </div>
          <div>
            <div className="font-sans text-3xs text-muted-foreground">{gt("Usage")}</div>
            <div>{formatPercent(context.usedPercent)}</div>
          </div>
        </div>
      </section>

      {/* Section 2: Prompt Cache (strictly separated from Context Used) */}
      <section className="flex flex-col gap-2 border-t border-border/50 pt-3">
        <div className="flex items-center justify-between gap-2">
          <span className="font-semibold">{gt("Prompt Cache")}</span>
          <span className="font-mono text-2xs text-muted-foreground tabular-nums">
            {cache.sessionHitRate !== null
              ? gt("Session {rate}", { rate: formatPercent(cache.sessionHitRate * 100) })
              : gt("Unavailable")}
          </span>
        </div>

        {cache.status !== "unavailable" ? (
          <>
            <div className="flex h-2 w-full overflow-hidden rounded-full bg-muted/70">
              <div
                className="h-full bg-primary"
                style={{ width: `${cacheReadPct}%` }}
                aria-label={gt("Cache Read")}
              />
              <div
                className="h-full bg-warning"
                style={{ width: `${cacheWritePct}%` }}
                aria-label={gt("Cache Write")}
              />
              <div
                className="h-full bg-muted-foreground/45"
                style={{ width: `${uncachedPct}%` }}
                aria-label={gt("Uncached Input")}
              />
            </div>
            <div className="grid grid-cols-2 gap-2 rounded-lg border border-border/50 bg-card/50 p-2 font-mono text-2xs tabular-nums">
              <div>
                <div className="font-sans text-3xs text-muted-foreground">{gt("Cache Read")}</div>
                <div>{formatCompactTokens(cache.cacheReadTokens)}</div>
              </div>
              <div>
                <div className="font-sans text-3xs text-muted-foreground">{gt("Cache Write")}</div>
                <div>{formatCompactTokens(cache.cacheWriteTokens)}</div>
              </div>
              <div>
                <div className="font-sans text-3xs text-muted-foreground">
                  {gt("Uncached Input")}
                </div>
                <div>{formatCompactTokens(cache.uncachedInputTokens)}</div>
              </div>
              <div>
                <div className="font-sans text-3xs text-muted-foreground">
                  {gt("Last Turn Hit Rate")}
                </div>
                <div>
                  {cache.lastTurnHitRate !== null
                    ? formatPercent(cache.lastTurnHitRate * 100)
                    : "--"}
                </div>
              </div>
            </div>
            <div className="text-3xs text-muted-foreground">
              {gt("Hit rate = Cache Read / Total Input (not subtracted from Context Used).")}
            </div>
          </>
        ) : (
          <div className="rounded-lg border border-border/40 bg-background/40 px-2.5 py-2 text-2xs text-muted-foreground">
            {cache.providerNote ?? gt("Prompt cache counters unavailable for this session.")}
          </div>
        )}
      </section>

      {/* Section 3: Agent Runtime Stats */}
      <section className="flex flex-col gap-2 border-t border-border/50 pt-3">
        <div className="flex items-center justify-between gap-2">
          <span className="font-semibold">{gt("Agent Runtime")}</span>
          <span className="rounded-full bg-muted px-2 py-0.5 text-3xs font-medium capitalize text-muted-foreground">
            {runtime.runStatus}
          </span>
        </div>
        <div className="grid grid-cols-4 gap-2 rounded-lg border border-border/50 bg-card/50 p-2 font-mono text-2xs tabular-nums">
          <div>
            <div className="font-sans text-3xs text-muted-foreground">{gt("Turns")}</div>
            <div>{runtime.turnCount}</div>
          </div>
          <div>
            <div className="font-sans text-3xs text-muted-foreground">{gt("Tools")}</div>
            <div>{runtime.toolCallCount}</div>
          </div>
          <div>
            <div className="font-sans text-3xs text-muted-foreground">{gt("Duration")}</div>
            <div>{formatDurationCompact(runtime.lastTurnDurationMs)}</div>
          </div>
          <div>
            <div className="font-sans text-3xs text-muted-foreground">{gt("Out")}</div>
            <div>{formatCompactTokens(runtime.totalOutputTokens)}</div>
          </div>
        </div>
      </section>
    </div>
  );
}
