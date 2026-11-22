import type {
  EnvironmentId,
  ProviderDriverKind,
  ProviderInstanceId,
  ServerProvider,
  ServerProviderUsageLimits,
  ServerProviderUsageWindow,
  UsageLimitSourceSnapshots,
} from "@t3tools/contracts";
import { PROVIDER_DISPLAY_NAMES } from "@t3tools/contracts";
import type { ContextWindowSnapshot } from "@t3tools/client-runtime/state/context-window";
import {
  type LimitPace,
  type LimitPoolWindow,
  paceOf,
  paceRemainingPercent,
  remainingPercent,
} from "@t3tools/shared/usageLimits";
import { formatDuration, limitsNotice } from "@t3tools/shared/usageLimitsCopy";
import { Link } from "@tanstack/react-router";
import { RefreshCwIcon } from "lucide-react";
import { msg, useGT, useMessages } from "gt-react";
import { useSyncExternalStore, type ReactNode } from "react";

import { useNowMinute } from "../../hooks/useNowMinute";
import { usePrimarySettings } from "../../hooks/useSettings";
import { cn } from "../../lib/utils";
import {
  deriveThreadMetrics,
  type MetricsProviderTurnLike,
  type MetricsTurnItemLike,
} from "../../metrics/contextCacheMetrics";
import {
  computeLedBlockStates,
  normalizePoolLabel,
  partitionProviderWindows,
} from "../../metrics/providerPools";
import { sharedMetricsRefreshCoordinator } from "../../metrics/refreshCoordinator";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { formatUpcomingTimestamp } from "../../timestampFormat";
import { formatCompactTokens, formatPercent } from "../metrics/MetricsStatusBar.logic";
import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { ThreadDetailsSection } from "./ThreadDetailsSection";
import { nextPoolReset, poolSources, resolveThreadDetailsLimits } from "./ThreadDetailsUsage.logic";

const PACE_LABEL: Record<LimitPace, string> = {
  ahead: msg("Ahead of pace"),
  on: msg("On pace"),
  under: msg("Under pace"),
};

export interface ThreadDetailsUsageInput {
  readonly environmentId?: EnvironmentId;
  readonly providerInstanceId: ProviderInstanceId | null;
  readonly model: string | null;
  readonly providers: readonly ServerProvider[];
  readonly sources: UsageLimitSourceSnapshots;
  readonly contextWindow: ContextWindowSnapshot | null;
  readonly providerTurns?: readonly MetricsProviderTurnLike[];
  readonly activeProviderThreadId?: string | null;
  readonly items?: readonly MetricsTurnItemLike[];
  readonly turnCount?: number;
  readonly isWorking?: boolean;
  readonly isCompacting?: boolean;
  readonly hasError?: boolean;
  readonly onCompactContext?: () => void;
}

type UsageTone = "error" | "warning" | null;

function limitTone(left: number): UsageTone {
  if (left <= 10) return "error";
  if (left <= 20) return "warning";
  return null;
}

function formatCompactRatio(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "--";
  if (value > 0 && value < 1) return `${value.toFixed(1)}%`;
  return `${Math.round(value)}%`;
}

function shortModelLabel(
  provider: ServerProvider | undefined,
  model: string | null,
): string | null {
  if (!model) return null;
  const found = provider?.models.find((m) => m.slug === model);
  if (found?.name) return found.name;
  const trimmed = model.slice(model.lastIndexOf("/") + 1);
  return trimmed || model;
}

function MiniRingGauge({
  remaining,
  tone,
}: {
  readonly remaining: number;
  readonly tone: UsageTone;
}) {
  const radius = 6.5;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(100, remaining));
  const dashOffset = circumference * (1 - clamped / 100);
  const strokeClass =
    tone === "error" ? "text-error" : tone === "warning" ? "text-warning" : "text-primary";

  return (
    <svg viewBox="0 0 18 18" className="size-4 shrink-0 -rotate-90" aria-hidden>
      <circle
        cx="9"
        cy="9"
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeWidth="2.4"
        className="text-muted/70"
      />
      <circle
        cx="9"
        cy="9"
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={dashOffset}
        className={strokeClass}
      />
    </svg>
  );
}

/**
 * Top-right floating card context + prompt cache section matching the
 * segmented Cached / Uncached / Free breakdown, cache hit rates, and Compact action.
 */
export function ThreadDetailsContext({
  usage,
  providerTurns = [],
  activeProviderThreadId = null,
  items = [],
  turnCount = 0,
  isWorking = false,
  isCompacting = false,
  hasError = false,
  modelName = null,
  modelId = null,
  providerDriver = null,
  onCompactContext,
}: {
  readonly usage: ContextWindowSnapshot | null;
  readonly providerTurns?: readonly MetricsProviderTurnLike[];
  readonly activeProviderThreadId?: string | null;
  readonly items?: readonly MetricsTurnItemLike[];
  readonly turnCount?: number;
  readonly isWorking?: boolean;
  readonly isCompacting?: boolean;
  readonly hasError?: boolean;
  readonly modelName?: string | null;
  readonly modelId?: string | null;
  readonly providerDriver?: string | null;
  readonly onCompactContext?: () => void;
}) {
  const gt = useGT();
  const metrics = deriveThreadMetrics({
    modelName,
    modelId,
    providerDriver,
    contextWindow: usage,
    providerTurns,
    activeProviderThreadId,
    items,
    turnCount,
    isWorking,
    isCompacting,
    hasError,
  });

  const { context, cache, runtime } = metrics;
  const maxTokens = context.contextWindowTokens;
  const usedTokens = context.usedTokens;
  const freeTokens = context.remainingTokens;

  const rawCachedContext =
    usage?.lastCachedInputTokens ??
    cache.lastTurn?.cacheReadTokens ??
    usage?.cachedInputTokens ??
    null;
  const cachedContextTokens =
    usedTokens !== null && rawCachedContext !== null && Number.isFinite(rawCachedContext)
      ? Math.min(usedTokens, Math.max(0, rawCachedContext))
      : null;
  const uncachedContextTokens =
    usedTokens !== null
      ? cachedContextTokens !== null
        ? Math.max(0, usedTokens - cachedContextTokens)
        : usedTokens
      : null;

  const cachedPct =
    maxTokens && maxTokens > 0 && cachedContextTokens !== null
      ? (cachedContextTokens / maxTokens) * 100
      : null;
  const uncachedPct =
    maxTokens && maxTokens > 0 && uncachedContextTokens !== null
      ? (uncachedContextTokens / maxTokens) * 100
      : null;
  const freePct =
    maxTokens && maxTokens > 0 && freeTokens !== null ? (freeTokens / maxTokens) * 100 : null;

  const totalUsedPct = context.usedPercent;
  const lastCacheRate =
    cache.lastTurnHitRate !== null ? Math.round(cache.lastTurnHitRate * 100) : null;
  const avgCacheRate =
    cache.sessionHitRate !== null ? Math.round(cache.sessionHitRate * 100) : null;

  return (
    <ThreadDetailsSection
      headingId="thread-details-context-heading"
      title={gt("Context")}
      separated={false}
    >
      <div className="flex flex-col gap-2.5 px-2.5 pb-1 text-xs">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-sm font-semibold text-foreground tabular-nums">
            {totalUsedPct !== null
              ? gt("{percent}% used", { percent: Math.round(totalUsedPct) })
              : gt("-- used")}
          </span>
          <span className="font-mono text-2xs text-muted-foreground tabular-nums">
            {usedTokens !== null
              ? maxTokens !== null
                ? `${formatCompactTokens(usedTokens)} / ${formatCompactTokens(maxTokens)}`
                : formatCompactTokens(usedTokens)
              : "--"}
          </span>
        </div>

        {/* 2-segment Context progress bar: Cached (info) + Uncached (primary fox-orange) */}
        <div className="flex h-2 w-full overflow-hidden rounded-full bg-muted/70">
          {cachedPct !== null && cachedPct > 0 ? (
            <div
              className="h-full bg-info transition-[width] duration-300 motion-reduce:transition-none"
              style={{ width: `${Math.min(100, cachedPct)}%` }}
            />
          ) : null}
          {uncachedPct !== null && uncachedPct > 0 ? (
            <div
              className="h-full bg-primary transition-[width] duration-300 motion-reduce:transition-none"
              style={{ width: `${Math.min(100, uncachedPct)}%` }}
            />
          ) : null}
        </div>

        {/* Cached / Uncached / Free breakdown rows */}
        <div className="grid grid-cols-[1fr_auto_3rem] items-center gap-x-2 gap-y-1.5 text-2xs">
          <span className="flex items-center gap-2 text-muted-foreground">
            <span className="size-2.5 shrink-0 rounded-xs bg-info" aria-hidden />
            <span className="truncate">{gt("Cached context")}</span>
          </span>
          <span className="font-mono text-foreground tabular-nums">
            {formatCompactTokens(cachedContextTokens)}
          </span>
          <span className="text-end font-mono text-muted-foreground tabular-nums">
            {formatCompactRatio(cachedPct)}
          </span>

          <span className="flex items-center gap-2 text-muted-foreground">
            <span className="size-2.5 shrink-0 rounded-xs bg-primary" aria-hidden />
            <span className="truncate">{gt("Uncached context")}</span>
          </span>
          <span className="font-mono text-foreground tabular-nums">
            {formatCompactTokens(uncachedContextTokens)}
          </span>
          <span className="text-end font-mono text-muted-foreground tabular-nums">
            {formatCompactRatio(uncachedPct)}
          </span>

          <span className="flex items-center gap-2 text-muted-foreground">
            <span
              className="size-2.5 shrink-0 rounded-xs border border-muted-foreground/50 bg-background/40"
              aria-hidden
            />
            <span className="truncate">{gt("Free space")}</span>
          </span>
          <span className="font-mono text-foreground tabular-nums">
            {formatCompactTokens(freeTokens)}
          </span>
          <span className="text-end font-mono text-muted-foreground tabular-nums">
            {formatCompactRatio(freePct)}
          </span>
        </div>

        {/* Prompt cache summary */}
        <div className="flex items-center justify-between border-t border-border/50 pt-2 text-2xs">
          <span className="text-muted-foreground">{gt("Prompt cache")}</span>
          {lastCacheRate !== null || avgCacheRate !== null ? (
            <span className="font-mono tabular-nums">
              <span className="font-semibold text-info">
                {formatPercent(lastCacheRate ?? avgCacheRate)}
              </span>
              {avgCacheRate !== null ? (
                <span className="text-muted-foreground">
                  {" "}
                  · {gt("avg {rate}%", { rate: avgCacheRate })}
                </span>
              ) : null}
            </span>
          ) : (
            <span className="font-mono text-muted-foreground">--</span>
          )}
        </div>

        {/* Turns · Tools + Compact action */}
        <div className="flex items-center justify-between gap-2 text-2xs">
          <span className="font-mono text-muted-foreground tabular-nums">
            {gt("{turns} turns · {tools} tools", {
              turns: runtime.turnCount,
              tools: runtime.toolCallCount,
            })}
          </span>
          {onCompactContext ? (
            <Button size="xs" variant="ghost" onClick={onCompactContext}>
              {gt("Compact")}
            </Button>
          ) : null}
        </div>
      </div>
    </ThreadDetailsSection>
  );
}

/**
 * Dynamically renders the active thread's provider quota with featured 16-block
 * LED cards for the active model pool and compact rows for other model pools.
 */
export function ThreadDetailsUsage({
  environmentId,
  providerInstanceId,
  model,
  providers,
  sources,
}: Omit<ThreadDetailsUsageInput, "contextWindow">) {
  const gt = useGT();
  const m = useMessages();
  const nowMinute = useNowMinute();
  const now = Date.parse(`${nowMinute}:00Z`);

  const refreshState = useSyncExternalStore(
    (listener) => sharedMetricsRefreshCoordinator.subscribe(listener),
    () => sharedMetricsRefreshCoordinator.getSnapshot(),
    () => sharedMetricsRefreshCoordinator.getSnapshot(),
  );
  const refreshProviders = useAtomCommand(serverEnvironment.refreshProviders);

  const activeProvider = providers.find((entry) => entry.instanceId === providerInstanceId);
  if (!activeProvider) return null;

  const resolved = resolveThreadDetailsLimits(providerInstanceId, model, providers, sources, now);
  const driverLabel =
    activeProvider.displayName?.trim() ||
    PROVIDER_DISPLAY_NAMES[activeProvider.driver] ||
    String(activeProvider.driver);
  const modelPill = shortModelLabel(activeProvider, model);
  const planLabel = activeProvider.auth.label?.trim() || null;

  const handleRefresh = () => {
    if (!environmentId) return;
    void sharedMetricsRefreshCoordinator.refresh(
      async () => {
        await refreshProviders({ environmentId, input: {} });
      },
      { manual: true },
    );
  };

  return (
    <ThreadDetailsSection
      headingId="thread-details-usage-heading"
      title={gt("Usage limits")}
      showHeading={false}
    >
      <div className="flex flex-col gap-2 px-2.5 pb-1 text-xs">
        {/* Provider · Model · Plan · Refresh */}
        <div className="flex items-center justify-between gap-1.5">
          <div className="flex min-w-0 shrink-0 items-center gap-1.5">
            <span className="shrink-0 font-semibold text-foreground">{driverLabel}</span>
            {modelPill ? (
              <>
                <span className="text-muted-foreground" aria-hidden>
                  ·
                </span>
                <span className="max-w-20 truncate rounded bg-muted/80 px-1.5 py-0.5 text-3xs font-medium text-foreground">
                  {modelPill}
                </span>
              </>
            ) : null}
          </div>
          <div className="flex min-w-0 items-center gap-1">
            {planLabel ? (
              <span className="min-w-0 truncate text-end text-3xs text-muted-foreground">
                {planLabel}
              </span>
            ) : null}
            {environmentId ? (
              <Button
                size="icon-xs"
                variant="ghost"
                aria-label={gt("Refresh provider quota")}
                disabled={refreshState.refreshing}
                onClick={handleRefresh}
              >
                <RefreshCwIcon
                  className={cn(
                    "size-3",
                    refreshState.refreshing && "animate-spin motion-reduce:animate-none",
                  )}
                />
              </Button>
            ) : null}
          </div>
        </div>

        {!resolved ? (
          <div className="rounded-lg border border-border/50 bg-background/40 px-2.5 py-2 text-2xs text-muted-foreground">
            {activeProvider.auth.status === "unauthenticated"
              ? gt("Not signed in. Authenticate this provider to read quota.")
              : gt("Quota unavailable for this provider.")}
          </div>
        ) : resolved.kind === "pool" ? (
          <PartitionedPoolContent
            driver={activeProvider.driver}
            model={model}
            windows={resolved.windows}
            now={now}
            renderFeatured={(win) => <FeaturedPoolCard key={win.id} window={win} now={now} />}
            renderOther={(win) => <CompactPoolRow key={win.id} window={win} now={now} />}
          />
        ) : (
          <InstanceQuotaContent
            driver={activeProvider.driver}
            model={model}
            limits={resolved.limits}
            now={now}
            notice={limitsNotice(resolved.limits, m)}
          />
        )}
      </div>
    </ThreadDetailsSection>
  );
}

function PartitionedPoolContent<
  W extends Pick<ServerProviderUsageWindow, "id" | "kind" | "label">,
>({
  driver,
  model,
  windows,
  renderFeatured,
  renderOther,
}: {
  readonly driver: ProviderDriverKind;
  readonly model: string | null;
  readonly windows: readonly W[];
  readonly now: number;
  readonly renderFeatured: (window: W) => ReactNode;
  readonly renderOther: (window: W) => ReactNode;
}) {
  const gt = useGT();
  const { primary, other } = partitionProviderWindows({ driver, model, windows });

  return (
    <>
      <div className="flex flex-col gap-2">{primary.map(renderFeatured)}</div>
      {other.length > 0 ? (
        <div className="flex flex-col gap-1 pt-1">
          <div className="text-3xs font-medium text-muted-foreground">
            {gt("Other model pools")}
          </div>
          <div className="flex flex-col gap-0.5">{other.map(renderOther)}</div>
        </div>
      ) : null}
    </>
  );
}

function InstanceQuotaContent({
  driver,
  model,
  limits,
  now,
  notice,
}: {
  readonly driver: ProviderDriverKind;
  readonly model: string | null;
  readonly limits: ServerProviderUsageLimits;
  readonly now: number;
  readonly notice: string | null;
}) {
  if (notice) {
    return (
      <div className="rounded-lg border border-border/50 bg-background/40 px-2.5 py-2 text-2xs text-muted-foreground">
        {notice}
      </div>
    );
  }
  return (
    <PartitionedPoolContent
      driver={driver}
      model={model}
      windows={limits.windows}
      now={now}
      renderFeatured={(win) => (
        <FeaturedInstanceCard key={win.id} driver={driver} window={win} now={now} />
      )}
      renderOther={(win) => (
        <CompactInstanceRow key={win.id} driver={driver} window={win} now={now} />
      )}
    />
  );
}

const LED_SLOT_KEYS = [
  "led-0",
  "led-1",
  "led-2",
  "led-3",
  "led-4",
  "led-5",
  "led-6",
  "led-7",
  "led-8",
  "led-9",
  "led-10",
  "led-11",
  "led-12",
  "led-13",
  "led-14",
  "led-15",
] as const;

function FeaturedQuotaCardShell({
  label,
  left,
  tone,
  timeLeft,
  resetText,
  tooltip,
}: {
  readonly label: string;
  readonly left: number;
  readonly tone: UsageTone;
  readonly timeLeft: number | null;
  readonly resetText: string | null;
  readonly tooltip: ReactNode;
}) {
  const gt = useGT();
  const blocks = computeLedBlockStates(left, 16);
  const fullColor =
    tone === "error" ? "bg-error" : tone === "warning" ? "bg-warning" : "bg-primary";
  const partialColor =
    tone === "error" ? "bg-error/45" : tone === "warning" ? "bg-warning/45" : "bg-primary/45";

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Link
            to="/usage"
            className="flex flex-col gap-1.5 rounded-xl border border-border/60 bg-background/50 p-2.5 transition-colors hover:border-border hover:bg-accent/20"
          />
        }
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-1.5">
            <MiniRingGauge remaining={left} tone={tone} />
            <span className="truncate font-medium text-foreground">{label}</span>
          </div>
          <span
            className={cn(
              "shrink-0 font-mono text-xs font-semibold tabular-nums",
              tone === "error"
                ? "text-error-foreground"
                : tone === "warning"
                  ? "text-warning-foreground"
                  : "text-foreground",
            )}
          >
            {left}%
          </span>
        </div>

        {/* 16-block segmented LED bar */}
        <div className="flex items-center gap-0.5" aria-hidden>
          {blocks.map((state, index) => (
            <span
              key={LED_SLOT_KEYS[index]}
              className={cn(
                "h-2.5 flex-1 rounded-xs",
                state === "full" ? fullColor : state === "partial" ? partialColor : "bg-muted/70",
              )}
            />
          ))}
        </div>

        {/* Pace hairline with time-remaining tick */}
        {timeLeft !== null ? (
          <div className="relative my-0.5 h-px w-full bg-border/80" aria-hidden>
            <span
              className="absolute -top-1 h-2.5 w-0.5 -translate-x-1/2 rounded-full bg-foreground"
              style={{ left: `clamp(2px, ${timeLeft}%, calc(100% - 2px))` }}
            />
          </div>
        ) : null}

        {resetText ? <div className="text-3xs text-muted-foreground">{resetText}</div> : null}
      </TooltipTrigger>
      <TooltipPopup side="left" sideOffset={16}>
        <div className="flex flex-col gap-0.5">
          {tooltip}
          <span className="text-muted-foreground">{gt("Open usage")}</span>
        </div>
      </TooltipPopup>
    </Tooltip>
  );
}

function FeaturedInstanceCard({
  driver,
  window,
  now,
}: {
  readonly driver: ProviderDriverKind;
  readonly window: ServerProviderUsageWindow;
  readonly now: number;
}) {
  const gt = useGT();
  const m = useMessages();
  const timestampFormat = usePrimarySettings((settings) => settings.timestampFormat);
  const left = remainingPercent(window);
  const pace = paceOf(window, now);
  const timeLeft = paceRemainingPercent(window, now);
  const resetsAt = window.resetsAt ? Date.parse(window.resetsAt) : Number.NaN;
  const label = normalizePoolLabel(driver, window);
  const resetText =
    window.resetsAt && resetsAt > now
      ? gt("Resets in {duration}", { duration: formatDuration(resetsAt - now, m) })
      : null;

  return (
    <FeaturedQuotaCardShell
      label={label}
      left={left}
      tone={limitTone(left)}
      timeLeft={timeLeft}
      resetText={resetText}
      tooltip={
        <>
          <span className="text-foreground">{gt("{label}: {left}% left", { label, left })}</span>
          {pace && timeLeft !== null ? (
            <span className="text-muted-foreground">
              {m(PACE_LABEL[pace])} · {gt("{timeLeft}% of the window left", { timeLeft })}
            </span>
          ) : null}
          {window.resetsAt && resetsAt > now ? (
            <span className="text-muted-foreground">
              {gt("Resets in {duration} · {time}", {
                duration: formatDuration(resetsAt - now, m),
                time: formatUpcomingTimestamp(window.resetsAt, timestampFormat, now, undefined, m),
              })}
            </span>
          ) : null}
        </>
      }
    />
  );
}

function FeaturedPoolCard({
  window,
  now,
}: {
  readonly window: LimitPoolWindow;
  readonly now: number;
}) {
  const gt = useGT();
  const m = useMessages();
  const timestampFormat = usePrimarySettings((settings) => settings.timestampFormat);
  const left = window.remainingPercent;
  const accounts = window.members.length;
  const from = poolSources(window);
  const sourceLabels = [...from.hubs, ...(from.signedIn ? [gt("Signed-in accounts")] : [])];
  const next = nextPoolReset(window, now);
  const resetsAt = next?.member.window.resetsAt;
  const reset =
    next && resetsAt
      ? {
          duration: formatDuration(next.at - now, m),
          time: formatUpcomingTimestamp(resetsAt, timestampFormat, now, undefined, m),
        }
      : null;

  return (
    <FeaturedQuotaCardShell
      label={window.label}
      left={left}
      tone={limitTone(left)}
      timeLeft={null}
      resetText={reset ? gt("Resets in {duration}", { duration: reset.duration }) : null}
      tooltip={
        <>
          <span className="text-foreground">
            {accounts > 1
              ? gt("{label}: {left}% left across {accounts} accounts", {
                  label: window.label,
                  left,
                  accounts,
                })
              : gt("{label}: {left}% left", { label: window.label, left })}
          </span>
          {window.pace ? (
            <span className="text-muted-foreground">{m(PACE_LABEL[window.pace])}</span>
          ) : null}
          {next && reset ? (
            <span className="text-muted-foreground">
              {accounts > 1
                ? gt("+{percent}% in {duration} · {time}", {
                    percent: next.restoresPercent,
                    ...reset,
                  })
                : gt("Resets in {duration} · {time}", reset)}
            </span>
          ) : null}
          {sourceLabels.length > 0 ? (
            <span className="text-muted-foreground">
              {gt("From {sources}", { sources: sourceLabels.join(", ") })}
            </span>
          ) : null}
        </>
      }
    />
  );
}

function CompactPoolRowShell({
  label,
  left,
  tone,
  tick,
  tooltip,
}: {
  readonly label: string;
  readonly left: number;
  readonly tone: UsageTone;
  readonly tick: number | null;
  readonly tooltip: ReactNode;
}) {
  const gt = useGT();
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Link
            to="/usage"
            className="grid h-6 grid-cols-[minmax(0,1fr)_4.5rem_2.5rem] items-center gap-2 rounded-md px-1.5 text-2xs transition-colors hover:bg-accent/30"
          />
        }
      >
        <span className="truncate text-muted-foreground">{label}</span>
        <span className="relative h-1.5 rounded-full bg-muted/65">
          {left > 0 ? (
            <span
              className={cn(
                "absolute inset-y-0 left-0 rounded-full",
                tone === "error"
                  ? "bg-error"
                  : tone === "warning"
                    ? "bg-warning"
                    : "bg-foreground/75",
              )}
              style={{ width: `max(${left}%, 4px)` }}
            />
          ) : null}
          {tick !== null ? (
            <span
              aria-hidden
              className="absolute -top-0.5 h-2.5 w-px -translate-x-1/2 bg-foreground"
              style={{ left: `clamp(1px, ${tick}%, calc(100% - 1px))` }}
            />
          ) : null}
        </span>
        <span className="text-end font-mono tabular-nums text-foreground/90">{left}%</span>
      </TooltipTrigger>
      <TooltipPopup side="left" sideOffset={16}>
        <div className="flex flex-col gap-0.5">
          {tooltip}
          <span className="text-muted-foreground">{gt("Open usage")}</span>
        </div>
      </TooltipPopup>
    </Tooltip>
  );
}

function CompactInstanceRow({
  driver,
  window,
  now,
}: {
  readonly driver: ProviderDriverKind;
  readonly window: ServerProviderUsageWindow;
  readonly now: number;
}) {
  const gt = useGT();
  const left = remainingPercent(window);
  const label = normalizePoolLabel(driver, window);
  return (
    <CompactPoolRowShell
      label={label}
      left={left}
      tone={limitTone(left)}
      tick={paceRemainingPercent(window, now)}
      tooltip={
        <span className="text-foreground">{gt("{label}: {left}% left", { label, left })}</span>
      }
    />
  );
}

function CompactPoolRow({
  window,
  now,
}: {
  readonly window: LimitPoolWindow;
  readonly now: number;
}) {
  const gt = useGT();
  const m = useMessages();
  const next = nextPoolReset(window, now);
  return (
    <CompactPoolRowShell
      label={window.label}
      left={window.remainingPercent}
      tone={limitTone(window.remainingPercent)}
      tick={null}
      tooltip={
        <>
          <span className="text-foreground">
            {gt("{label}: {left}% left", { label: window.label, left: window.remainingPercent })}
          </span>
          {next ? (
            <span className="text-muted-foreground">
              {gt("Resets in {duration}", { duration: formatDuration(next.at - now, m) })}
            </span>
          ) : null}
        </>
      }
    />
  );
}
