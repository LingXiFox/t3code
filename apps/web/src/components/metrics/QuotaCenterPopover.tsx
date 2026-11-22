import { Link } from "@tanstack/react-router";
import { useGT } from "gt-react";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  ExternalLinkIcon,
  RefreshCwIcon,
  SlidersHorizontalIcon,
} from "lucide-react";
import { useState } from "react";

import type { MetricsBarPreferences } from "../../metrics/preferences";
import type { RefreshCoordinatorState } from "../../metrics/refreshCoordinator";
import type { QuotaPlatformId, QuotaPlatformSnapshot, QuotaStatus } from "../../metrics/types";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { formatResetCountdown, quotaBarTone, statusBadgeTone } from "./MetricsStatusBar.logic";

function StatusBadge({ status }: { readonly status: QuotaStatus }) {
  const gt = useGT();
  const tone = statusBadgeTone(status);
  const label = (() => {
    switch (status) {
      case "available":
        return gt("Available");
      case "partial":
        return gt("Partial");
      case "stale":
        return gt("Stale");
      case "unauthorized":
        return gt("Unauthorized");
      case "error":
        return gt("Error");
      case "unavailable":
        return gt("Unavailable");
    }
  })();

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-1.5 py-0.5 text-3xs font-medium",
        tone === "success" && "bg-primary/15 text-primary",
        tone === "warning" && "bg-warning-surface text-warning-foreground",
        tone === "error" && "bg-error-surface text-error-foreground",
        tone === "muted" && "bg-muted text-muted-foreground",
      )}
    >
      {label}
    </span>
  );
}

export function QuotaCenterPopover({
  allQuotas,
  visibleQuotas,
  preferences,
  setPreferences,
  refreshState,
  onRefresh,
  nowMs,
}: {
  readonly allQuotas: readonly QuotaPlatformSnapshot[];
  readonly visibleQuotas: readonly QuotaPlatformSnapshot[];
  readonly preferences: MetricsBarPreferences;
  readonly setPreferences: (patch: Partial<MetricsBarPreferences>) => void;
  readonly refreshState: RefreshCoordinatorState;
  readonly onRefresh: () => void;
  readonly nowMs: number;
}) {
  const gt = useGT();
  const [customizing, setCustomizing] = useState(false);
  const enabledSet = new Set(preferences.enabledPlatforms);

  const togglePlatform = (id: QuotaPlatformId) => {
    const next = enabledSet.has(id)
      ? preferences.enabledPlatforms.filter((entry) => entry !== id)
      : preferences.platformOrder.filter((entry) => entry === id || enabledSet.has(entry));
    setPreferences({ enabledPlatforms: next });
  };

  const movePlatform = (id: QuotaPlatformId, delta: -1 | 1) => {
    const order = [...preferences.platformOrder];
    const index = order.indexOf(id);
    const target = index + delta;
    if (index < 0 || target < 0 || target >= order.length) return;
    const [item] = order.splice(index, 1);
    if (!item) return;
    order.splice(target, 0, item);
    setPreferences({
      platformOrder: order,
      enabledPlatforms: order.filter((entry) => enabledSet.has(entry)),
    });
  };

  return (
    <div
      data-metrics-panel="quota-center"
      className="flex w-[min(92vw,720px)] max-h-[75vh] flex-col gap-3 p-1 text-xs text-foreground"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 pb-2.5">
        <div className="flex flex-col gap-0.5">
          <span className="text-sm font-semibold">{gt("Unified Quota Center")}</span>
          <span className="text-2xs text-muted-foreground">
            {refreshState.lastRefreshedAtMs
              ? gt("Last synced {time}", {
                  time: new Date(refreshState.lastRefreshedAtMs).toLocaleTimeString(),
                })
              : gt("Live provider snapshots")}
            {refreshState.backoffUntilMs && nowMs < refreshState.backoffUntilMs
              ? ` · ${gt("Backoff active")}`
              : ""}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <Button
            size="xs"
            variant={preferences.autoRefresh ? "secondary" : "ghost"}
            onClick={() => setPreferences({ autoRefresh: !preferences.autoRefresh })}
          >
            {preferences.autoRefresh ? gt("Auto-refresh On") : gt("Auto-refresh Off")}
          </Button>
          <Button
            size="xs"
            variant={customizing ? "secondary" : "ghost"}
            onClick={() => setCustomizing((prev) => !prev)}
          >
            <SlidersHorizontalIcon className="size-3.5" aria-hidden />
            <span>{gt("Customize")}</span>
          </Button>
          <Button
            size="xs"
            variant="outline"
            disabled={refreshState.refreshing}
            onClick={onRefresh}
          >
            <RefreshCwIcon
              className={cn(
                "size-3.5",
                refreshState.refreshing && "animate-spin motion-reduce:animate-none",
              )}
              aria-hidden
            />
            <span>{gt("Refresh")}</span>
          </Button>
          <Link
            to="/usage"
            className="inline-flex h-6 items-center gap-1 rounded-md border border-border/70 px-2 text-2xs text-muted-foreground hover:bg-accent/30 hover:text-foreground"
          >
            <span>{gt("Full Usage")}</span>
            <ExternalLinkIcon className="size-3" aria-hidden />
          </Link>
        </div>
      </div>

      {customizing ? (
        <div className="rounded-lg border border-border/60 bg-background/60 p-2.5">
          <div className="mb-2 text-2xs font-medium text-muted-foreground">
            {gt("Select and order displayed platforms")}
          </div>
          <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
            {allQuotas.map((platform, idx) => (
              <div
                key={platform.platformId}
                className="flex items-center justify-between rounded-md border border-border/50 bg-card/50 px-2 py-1"
              >
                <label className="flex cursor-pointer items-center gap-2">
                  <input
                    type="checkbox"
                    checked={enabledSet.has(platform.platformId)}
                    onChange={() => togglePlatform(platform.platformId)}
                    className="accent-primary"
                  />
                  <span
                    className="size-2 rounded-full"
                    style={{ backgroundColor: platform.accentColor }}
                    aria-hidden
                  />
                  <span>{platform.platformName}</span>
                </label>
                <div className="flex items-center gap-0.5">
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    aria-label={gt("Move {name} up", { name: platform.platformName })}
                    disabled={idx === 0}
                    onClick={() => movePlatform(platform.platformId, -1)}
                  >
                    <ArrowUpIcon className="size-3" />
                  </Button>
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    aria-label={gt("Move {name} down", { name: platform.platformName })}
                    disabled={idx === allQuotas.length - 1}
                    onClick={() => movePlatform(platform.platformId, 1)}
                  >
                    <ArrowDownIcon className="size-3" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-2.5 overflow-y-auto pr-0.5 sm:grid-cols-2">
        {visibleQuotas.length === 0 ? (
          <div className="col-span-full rounded-lg border border-dashed border-border/60 p-6 text-center text-muted-foreground">
            {gt("No platforms selected. Open Customize to enable platforms.")}
          </div>
        ) : (
          visibleQuotas.map((platform) => (
            <section
              key={platform.platformId}
              data-metrics-platform-card={platform.platformId}
              className="flex flex-col gap-2 rounded-xl border border-border/60 bg-card/60 p-3"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                  <span
                    className="size-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: platform.accentColor }}
                    aria-hidden
                  />
                  <div className="min-w-0">
                    <div className="truncate font-semibold">{platform.platformName}</div>
                    {platform.accounts[0] ? (
                      <div className="truncate text-3xs text-muted-foreground">
                        {platform.accounts[0].safeAlias}
                        {platform.accounts[0].plan ? ` · ${platform.accounts[0].plan}` : ""}
                      </div>
                    ) : null}
                  </div>
                </div>
                <StatusBadge status={platform.status} />
              </div>

              {platform.windows.length > 0 ? (
                <div className="flex flex-col gap-2">
                  {platform.windows.map((win) => {
                    const tone = quotaBarTone(win.remainingPercent);
                    const resetLabel = formatResetCountdown(win.resetAt, nowMs);
                    return (
                      <div key={win.id} className="flex flex-col gap-1">
                        <div className="flex items-center justify-between gap-2 text-2xs">
                          <span className="truncate font-medium">
                            {win.poolName}
                            <span className="ml-1.5 text-3xs text-muted-foreground">
                              {win.windowKind}
                            </span>
                          </span>
                          <span className="shrink-0 font-mono tabular-nums">
                            {win.remainingPercent !== null ? `${win.remainingPercent}%` : "--"}
                            {resetLabel ? (
                              <span className="ml-1.5 text-3xs text-muted-foreground">
                                {gt("resets {in}", { in: resetLabel })}
                              </span>
                            ) : null}
                          </span>
                        </div>
                        <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted/70">
                          <div
                            className={cn(
                              "h-full rounded-full transition-[width] duration-300 motion-reduce:transition-none",
                              tone === "error"
                                ? "bg-error"
                                : tone === "warning"
                                  ? "bg-warning"
                                  : "bg-primary",
                            )}
                            style={{ width: `${win.remainingPercent ?? 0}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="rounded-lg border border-border/40 bg-background/40 px-2.5 py-2 text-2xs text-muted-foreground">
                  {platform.reason ?? gt("Quota unavailable for this platform.")}
                </div>
              )}

              <div className="mt-auto flex items-center justify-between gap-2 pt-1 text-3xs text-muted-foreground">
                <span className="truncate">{platform.source}</span>
                {platform.updatedAt ? (
                  <span className="shrink-0 font-mono">
                    {new Date(platform.updatedAt).toLocaleTimeString()}
                  </span>
                ) : null}
              </div>
            </section>
          ))
        )}
      </div>
    </div>
  );
}
