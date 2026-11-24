import { useGT } from "gt-react";
import { EyeIcon, EyeOffIcon, RefreshCwIcon } from "lucide-react";

import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { ContextCachePopover } from "./ContextCachePopover";
import {
  formatPercent,
  lowestRemainingWindow,
  quotaBarTone,
  shortPlatformName,
} from "./MetricsStatusBar.logic";
import { QuotaCenterPopover } from "./QuotaCenterPopover";
import { useUnifiedMetrics } from "./useUnifiedMetrics";

export function MetricsStatusBar({ hidden = false }: { readonly hidden?: boolean }) {
  const gt = useGT();
  const {
    nowMs,
    preferences,
    setPreferences,
    refreshState,
    refreshNow,
    allQuotas,
    visibleQuotas,
    threadMetrics,
  } = useUnifiedMetrics();

  if (hidden) return null;

  if (!preferences.visible) {
    return (
      <div className="pointer-events-none fixed right-3 bottom-2 z-30">
        <div className="pointer-events-auto">
          <Button
            size="xs"
            variant="glass"
            data-metrics-status-bar-restore=""
            onClick={() => setPreferences({ visible: true })}
          >
            <EyeIcon className="size-3" aria-hidden />
            <span>{gt("Metrics")}</span>
          </Button>
        </div>
      </div>
    );
  }

  const { context, cache, runtime } = threadMetrics;
  const runDotClass =
    runtime.runStatus === "running" || runtime.runStatus === "compacting"
      ? "bg-primary live-run-pulse motion-reduce:animate-none"
      : runtime.runStatus === "error"
        ? "bg-error"
        : "bg-primary/70";

  return (
    <footer
      data-metrics-status-bar=""
      aria-label={gt("Unified metrics status bar")}
      className="flex h-8 shrink-0 items-center justify-between gap-2 border-t border-border/60 bg-background/80 px-2.5 text-2xs text-muted-foreground backdrop-blur-md"
    >
      {/* Left: Model, Context Window & Prompt Cache */}
      <Popover>
        <PopoverTrigger
          render={
            <button
              type="button"
              data-metrics-context-trigger=""
              className="flex min-w-0 items-center gap-2 rounded-md px-1.5 py-0.5 transition-colors hover:bg-accent/40 hover:text-foreground"
            />
          }
        >
          <span className={cn("size-1.5 shrink-0 rounded-full", runDotClass)} aria-hidden />
          <span className="max-w-28 truncate font-medium text-foreground sm:max-w-40">
            {context.modelName ?? gt("No model")}
          </span>
          <span className="flex items-center gap-1 font-mono text-3xs tabular-nums">
            <span>{gt("Ctx")}</span>
            <span>{formatPercent(context.usedPercent)}</span>
          </span>
          <span className="hidden items-center gap-1 font-mono text-3xs tabular-nums sm:flex">
            <span>{gt("Cache")}</span>
            <span>
              {cache.sessionHitRate !== null ? formatPercent(cache.sessionHitRate * 100) : "--"}
            </span>
          </span>
        </PopoverTrigger>
        <PopoverPopup side="top" align="start">
          <ContextCachePopover context={context} cache={cache} runtime={runtime} />
        </PopoverPopup>
      </Popover>

      {/* Right: Platform Quotas + Controls */}
      <div className="flex min-w-0 items-center gap-1">
        <Popover>
          <PopoverTrigger
            render={
              <button
                type="button"
                data-metrics-quota-trigger=""
                className="flex min-w-0 items-center gap-1.5 rounded-md px-1.5 py-0.5 transition-colors hover:bg-accent/40 hover:text-foreground"
              />
            }
          >
            {visibleQuotas.slice(0, 4).map((platform, idx) => {
              const lowest = lowestRemainingWindow(platform.windows);
              const tone = quotaBarTone(lowest?.remainingPercent ?? null);
              return (
                <span
                  key={platform.platformId}
                  className={cn(
                    "items-center gap-1 rounded bg-card/60 px-1.5 py-0.5 font-mono text-3xs tabular-nums",
                    idx === 0
                      ? "inline-flex"
                      : idx < 2
                        ? "hidden sm:inline-flex"
                        : "hidden lg:inline-flex",
                  )}
                >
                  <span
                    className="size-1.5 rounded-full"
                    style={{ backgroundColor: platform.accentColor }}
                    aria-hidden
                  />
                  <span>{shortPlatformName(platform.platformId)}</span>
                  <span
                    className={cn(
                      tone === "error"
                        ? "text-error-foreground"
                        : tone === "warning"
                          ? "text-warning-foreground"
                          : "text-foreground",
                    )}
                  >
                    {lowest?.remainingPercent !== null && lowest?.remainingPercent !== undefined
                      ? `${lowest.remainingPercent}%`
                      : "--"}
                  </span>
                </span>
              );
            })}
            <span className="inline-flex items-center rounded bg-card/60 px-1.5 py-0.5 text-3xs lg:hidden">
              {gt("{count} platforms", { count: visibleQuotas.length })}
            </span>
          </PopoverTrigger>
          <PopoverPopup side="top" align="end">
            <QuotaCenterPopover
              allQuotas={allQuotas}
              visibleQuotas={visibleQuotas}
              preferences={preferences}
              setPreferences={setPreferences}
              refreshState={refreshState}
              onRefresh={() => void refreshNow(true)}
              nowMs={nowMs}
            />
          </PopoverPopup>
        </Popover>

        <Button
          size="icon-xs"
          variant="ghost"
          aria-label={gt("Refresh quotas")}
          disabled={refreshState.refreshing}
          onClick={() => void refreshNow(true)}
        >
          <RefreshCwIcon
            className={cn(
              "size-3",
              refreshState.refreshing && "animate-spin motion-reduce:animate-none",
            )}
          />
        </Button>
        <Button
          size="icon-xs"
          variant="ghost"
          aria-label={gt("Hide metrics bar")}
          onClick={() => setPreferences({ visible: false })}
        >
          <EyeOffIcon className="size-3" />
        </Button>
      </div>
    </footer>
  );
}
