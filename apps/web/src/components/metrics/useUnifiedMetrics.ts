import { useAtomValue } from "@effect/atom-react";
import {
  deriveLatestContextWindowSnapshot,
  latestProviderTurnTokenUsage,
} from "@t3tools/client-runtime/state/context-window";
import * as Option from "effect/Option";
import { useEffect, useSyncExternalStore } from "react";

import { useComposerDraftStore } from "../../composerDraftStore";
import { useNowMinute } from "../../hooks/useNowMinute";
import { useShownThreadRouteTarget } from "../../hooks/useShownThreadRouteTarget";
import { useStableCallback } from "../../hooks/useStableCallback";
import { collectUnifiedQuotaMetrics } from "../../metrics/adapters";
import { deriveThreadMetrics } from "../../metrics/contextCacheMetrics";
import {
  getMetricsPreferencesSnapshot,
  subscribeMetricsPreferences,
  updateMetricsPreferences,
  type MetricsBarPreferences,
} from "../../metrics/preferences";
import { sharedMetricsRefreshCoordinator } from "../../metrics/refreshCoordinator";
import type { QuotaPlatformSnapshot } from "../../metrics/types";
import { useQuietThreadVisibleTurnItems, useThreadError } from "../../state/entities";
import { environmentPresentations } from "../../state/presentation";
import { serverEnvironment } from "../../state/server";
import { useEnvironmentThread } from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";

export function useUnifiedMetrics() {
  const presentations = useAtomValue(environmentPresentations.presentationsAtom);
  const presentationsWithProviders = useAtomValue(
    environmentPresentations.presentationsWithProvidersAtom,
  );
  const nowMinute = useNowMinute();
  const nowMs = Date.parse(`${nowMinute}:00Z`);

  const preferences = useSyncExternalStore(
    subscribeMetricsPreferences,
    getMetricsPreferencesSnapshot,
    getMetricsPreferencesSnapshot,
  );
  const refreshState = useSyncExternalStore(
    (listener) => sharedMetricsRefreshCoordinator.subscribe(listener),
    () => sharedMetricsRefreshCoordinator.getSnapshot(),
    () => sharedMetricsRefreshCoordinator.getSnapshot(),
  );

  const refreshProviders = useAtomCommand(serverEnvironment.refreshProviders);

  const refreshNow = useStableCallback((manual: boolean = true) =>
    sharedMetricsRefreshCoordinator.refresh(
      async () => {
        const connected = Array.from(presentations.entries()).filter(
          ([, presentation]) =>
            presentation.connection.phase === "connected" && presentation.serverConfig !== null,
        );
        if (connected.length === 0) return;
        await Promise.all(
          connected.map(([environmentId]) => refreshProviders({ environmentId, input: {} })),
        );
      },
      { manual },
    ),
  );

  // Periodic background auto-refresh respecting document visibility and backoff.
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- coordinates periodic background quota probes
  useEffect(() => {
    if (!preferences.autoRefresh) return;
    const maybeRefresh = () => {
      const visible =
        typeof document === "undefined" ? true : document.visibilityState === "visible";
      if (sharedMetricsRefreshCoordinator.shouldAutoRefresh(visible)) {
        void refreshNow(false);
      }
    };
    const timer = window.setInterval(maybeRefresh, 60_000);
    const onVisibility = () => {
      if (document.visibilityState === "visible") maybeRefresh();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [preferences.autoRefresh, refreshNow]);

  const allQuotas = collectUnifiedQuotaMetrics({
    presentations: presentationsWithProviders,
    nowMs,
    order: preferences.platformOrder,
  });

  const enabledQuotaSet = new Set(preferences.enabledPlatforms);
  const visibleQuotas = allQuotas.filter((entry) => enabledQuotaSet.has(entry.platformId));

  // Active thread & model metrics (follows thread & model switching reactively)
  const { shownTarget } = useShownThreadRouteTarget();
  const serverRef = shownTarget?.kind === "server" ? shownTarget.threadRef : null;
  const draftId = shownTarget?.kind === "draft" ? shownTarget.draftId : null;
  const draftSession = useComposerDraftStore((store) =>
    draftId ? store.getDraftSession(draftId) : null,
  );

  const threadDetail = useEnvironmentThread(
    serverRef?.environmentId ?? null,
    serverRef?.threadId ?? null,
  );
  const projection = Option.getOrNull(threadDetail.data);
  const visibleTurnItems = useQuietThreadVisibleTurnItems(serverRef);
  const threadError = useThreadError(serverRef);

  const activeProviderThread = projection?.providerThreads.find(
    (thread) => thread.id === projection.thread.activeProviderThreadId,
  );
  const liveTokenUsage = latestProviderTurnTokenUsage(
    projection?.providerTurns ?? [],
    projection,
    activeProviderThread,
  );
  const contextWindow = deriveLatestContextWindowSnapshot(
    visibleTurnItems ?? [],
    liveTokenUsage,
    activeProviderThread,
  );

  const activeEnvId = serverRef?.environmentId ?? draftSession?.environmentId ?? null;
  const activeSelection = projection?.thread.modelSelection ?? null;
  const activeProviders =
    (activeEnvId ? presentationsWithProviders.get(activeEnvId)?.serverConfig?.providers : null) ??
    [];
  const activeProvider = activeSelection
    ? activeProviders.find((p) => p.instanceId === activeSelection.instanceId)
    : undefined;
  const activeModel = activeSelection
    ? activeProvider?.models.find((m) => m.slug === activeSelection.model)
    : undefined;

  const isWorking = Boolean(
    projection?.runs.some(
      (run) => run.status === "running" || run.status === "preparing" || run.status === "starting",
    ),
  );
  const isCompacting = Boolean(
    visibleTurnItems?.some(
      (entry) =>
        entry.item.type === "compaction" &&
        (entry.item.status === "running" || entry.item.status === "pending"),
    ),
  );

  const threadMetrics = deriveThreadMetrics({
    modelName: activeModel?.name ?? activeSelection?.model ?? null,
    modelId: activeSelection?.model ?? null,
    providerDriver: activeProvider?.driver ?? null,
    contextWindow,
    providerTurns: projection?.providerTurns ?? [],
    activeProviderThreadId: projection?.thread.activeProviderThreadId ?? null,
    items: (visibleTurnItems ?? []).map((entry) => entry.item),
    turnCount: projection?.providerTurns.length ?? 0,
    isWorking,
    isCompacting,
    hasError: threadError !== null,
  });

  const setPreferences = (patch: Partial<MetricsBarPreferences>) => updateMetricsPreferences(patch);

  return {
    nowMs,
    preferences,
    setPreferences,
    refreshState,
    refreshNow,
    allQuotas,
    visibleQuotas,
    threadMetrics,
  };
}

export type { QuotaPlatformSnapshot };
