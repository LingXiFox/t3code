import type {
  ProviderDriverKind,
  ServerProvider,
  ServerProviderUsageLimits,
  ServerProviderUsageWindow,
  UsageLimitSourceAccount,
} from "@t3tools/contracts";
import { paceOf, type LimitPresentations } from "@t3tools/shared/usageLimits";

import type {
  QuotaAccountSummary,
  QuotaPlatformId,
  QuotaPlatformSnapshot,
  QuotaPoolWindow,
  QuotaStatus,
  QuotaWindowKind,
} from "../types";

const QUOTA_STALE_THRESHOLD_MS = 15 * 60_000;

export interface AdapterCollectInput {
  readonly presentations: LimitPresentations;
  readonly nowMs: number;
}

export interface QuotaPlatformAdapter {
  readonly platformId: QuotaPlatformId;
  readonly driverKind: ProviderDriverKind;
  readonly platformName: string;
  readonly accentColor: string;
  collect(input: AdapterCollectInput): QuotaPlatformSnapshot;
}

export interface CollectedDriverSources {
  readonly providers: ReadonlyArray<{
    readonly environmentLabel: string;
    readonly provider: ServerProvider;
  }>;
  readonly hubAccounts: ReadonlyArray<{
    readonly environmentLabel: string;
    readonly sourceLabel: string;
    readonly account: UsageLimitSourceAccount;
  }>;
}

export function collectDriverSources(
  presentations: LimitPresentations,
  driverKind: ProviderDriverKind,
): CollectedDriverSources {
  const providers: Array<{ environmentLabel: string; provider: ServerProvider }> = [];
  const hubAccounts: Array<{
    environmentLabel: string;
    sourceLabel: string;
    account: UsageLimitSourceAccount;
  }> = [];

  for (const presentation of presentations.values()) {
    const environmentLabel = presentation.entry.target.label;
    for (const provider of presentation.serverConfig?.providers ?? []) {
      if (provider.driver === driverKind) {
        providers.push({ environmentLabel, provider });
      }
    }
    for (const source of presentation.serverConfig?.usageLimitSources ?? []) {
      for (const account of source.accounts) {
        if (account.driver === driverKind) {
          hubAccounts.push({ environmentLabel, sourceLabel: source.label, account });
        }
      }
    }
  }

  return { providers, hubAccounts };
}

/** Never exposes tokens/cookies; masks email local-part beyond first two characters. */
export function formatSafeAccountAlias(input: {
  readonly email?: string | undefined;
  readonly displayName?: string | undefined;
  readonly fallback: string;
}): string {
  const email = input.email?.trim();
  if (email) {
    const at = email.indexOf("@");
    if (at > 0) {
      const local = email.slice(0, at);
      const domain = email.slice(at + 1);
      const maskedLocal = local.length <= 2 ? `${local[0] ?? "*"}*` : `${local.slice(0, 2)}***`;
      return domain ? `${maskedLocal}@${domain}` : maskedLocal;
    }
  }
  const name = input.displayName?.trim();
  if (name) return name;
  return input.fallback;
}

function normalizeWindowKind(
  kind: ServerProviderUsageWindow["kind"],
  windowDurationMins?: number,
): QuotaWindowKind {
  if (windowDurationMins !== undefined && Number.isFinite(windowDurationMins)) {
    if (windowDurationMins >= 25 * 24 * 60) return "monthly";
    if (windowDurationMins >= 6 * 24 * 60) return "weekly";
    if (windowDurationMins >= 20 * 60 && windowDurationMins <= 28 * 60) return "daily";
    if (windowDurationMins >= 4 * 60 && windowDurationMins <= 6 * 60) return "5h";
  }
  switch (kind) {
    case "session":
      return "5h";
    case "weekly":
      return "weekly";
    case "monthly":
      return "monthly";
    default:
      return "custom";
  }
}

function isSnapshotStale(
  checkedAt: string | null | undefined,
  nowMs: number,
  thresholdMs = QUOTA_STALE_THRESHOLD_MS,
): boolean {
  if (!checkedAt) return false;
  const parsed = Date.parse(checkedAt);
  if (!Number.isFinite(parsed)) return false;
  return nowMs - parsed > thresholdMs;
}

function normalizeUsageWindow(
  window: ServerProviderUsageWindow,
  nowMs: number,
  options?: { readonly poolName?: string; readonly label?: string },
): QuotaPoolWindow | null {
  if (typeof window.usedPercent !== "number" || !Number.isFinite(window.usedPercent)) {
    return null;
  }
  const usedPercent = Math.round(Math.max(0, Math.min(100, window.usedPercent)));
  const remainingPercent = Math.max(0, 100 - usedPercent);
  return {
    id: window.id,
    poolName: options?.poolName ?? window.label,
    label: options?.label ?? window.label,
    windowKind: normalizeWindowKind(window.kind, window.windowDurationMins),
    windowDurationMins:
      typeof window.windowDurationMins === "number" && Number.isFinite(window.windowDurationMins)
        ? window.windowDurationMins
        : null,
    unit: "percent",
    usedPercent,
    remainingPercent,
    usedAmount: null,
    limitAmount: null,
    resetAt: window.resetsAt ?? null,
    modelIds: window.modelIds ?? null,
    pace: paceOf(window, nowMs),
    raw: window,
  };
}

function latestCheckedAt(
  limitsList: ReadonlyArray<ServerProviderUsageLimits | undefined>,
): string | null {
  let latest: string | null = null;
  let latestMs = Number.NEGATIVE_INFINITY;
  for (const limits of limitsList) {
    if (!limits?.checkedAt) continue;
    const ms = Date.parse(limits.checkedAt);
    if (Number.isFinite(ms) && ms >= latestMs) {
      latestMs = ms;
      latest = limits.checkedAt;
    }
  }
  return latest;
}

export function buildStandardPlatformSnapshot(input: {
  readonly adapter: Pick<
    QuotaPlatformAdapter,
    "platformId" | "driverKind" | "platformName" | "accentColor"
  >;
  readonly sources: CollectedDriverSources;
  readonly nowMs: number;
  readonly sourceLabel: string;
  readonly transformWindows?: (windows: readonly QuotaPoolWindow[]) => readonly QuotaPoolWindow[];
  readonly unavailableOverride?: (context: {
    readonly providers: CollectedDriverSources["providers"];
    readonly firstLimits: ServerProviderUsageLimits | undefined;
  }) => { readonly status?: QuotaStatus; readonly reason: string } | null;
}): QuotaPlatformSnapshot {
  const { adapter, sources, nowMs, sourceLabel } = input;
  const activeProviders = sources.providers.filter((entry) => entry.provider.enabled);
  const accounts: QuotaAccountSummary[] = [];
  const windows: QuotaPoolWindow[] = [];
  const limitsList: Array<ServerProviderUsageLimits | undefined> = [];
  let externalUsageUrl: string | null = null;
  let firstProbeFailure: string | null = null;
  let firstUnsupported: string | null = null;
  let unauthorizedCount = 0;

  for (const { environmentLabel, provider } of activeProviders) {
    if (provider.auth.status === "unauthenticated") {
      unauthorizedCount += 1;
    }
    const limits = provider.usageLimits;
    limitsList.push(limits);
    if (limits?.externalUsage?.url && !externalUsageUrl) {
      externalUsageUrl = limits.externalUsage.url;
    }
    if (limits?.unavailable?.reason === "probeFailed" && !firstProbeFailure) {
      firstProbeFailure = limits.unavailable.message ?? "Usage probe failed.";
    }
    if (limits?.unavailable?.reason === "unsupported" && !firstUnsupported) {
      firstUnsupported = limits.unavailable.message ?? "No subscription quota source reported.";
    }

    accounts.push({
      accountKey: `${environmentLabel}:${provider.instanceId}`,
      safeAlias: formatSafeAccountAlias({
        email: provider.auth.email,
        displayName: provider.displayName,
        fallback: adapter.platformName,
      }),
      plan: provider.auth.label ?? null,
      environmentLabels: [environmentLabel],
      sourceLabel: null,
    });

    if (limits && !limits.unavailable) {
      for (const win of limits.windows) {
        const normalized = normalizeUsageWindow(win, nowMs);
        if (normalized && !windows.some((existing) => existing.id === normalized.id)) {
          windows.push(normalized);
        }
      }
    }
  }

  for (const { environmentLabel, sourceLabel: hubLabel, account } of sources.hubAccounts) {
    limitsList.push(account.usageLimits);
    accounts.push({
      accountKey: `${environmentLabel}:${hubLabel}:${account.id}`,
      safeAlias: formatSafeAccountAlias({
        email: account.email,
        displayName: account.id.replace(/\.json$/i, ""),
        fallback: adapter.platformName,
      }),
      plan: account.plan ?? null,
      environmentLabels: [environmentLabel],
      sourceLabel: hubLabel,
    });
    if (!account.usageLimits.unavailable) {
      for (const win of account.usageLimits.windows) {
        const normalized = normalizeUsageWindow(win, nowMs);
        if (normalized && !windows.some((existing) => existing.id === normalized.id)) {
          windows.push(normalized);
        }
      }
    }
  }

  const finalWindows = input.transformWindows ? input.transformWindows(windows) : windows;
  const updatedAt = latestCheckedAt(limitsList);
  const stale = finalWindows.length > 0 && isSnapshotStale(updatedAt, nowMs);

  let status: QuotaStatus;
  let reason: string | null = null;
  let errorMessage: string | null = null;

  if (finalWindows.length > 0) {
    status = stale ? "stale" : firstProbeFailure ? "partial" : "available";
    if (firstProbeFailure) {
      reason = firstProbeFailure;
    }
  } else {
    const firstLimits = activeProviders.find((entry) => entry.provider.usageLimits)?.provider
      .usageLimits;
    const override = input.unavailableOverride?.({ providers: activeProviders, firstLimits });
    if (override) {
      status = override.status ?? "unavailable";
      reason = override.reason;
    } else if (activeProviders.length === 0 && sources.hubAccounts.length === 0) {
      status = "unavailable";
      reason = "Provider is not configured or disabled in this environment.";
    } else if (unauthorizedCount > 0 && unauthorizedCount === activeProviders.length) {
      status = "unauthorized";
      reason = "Not signed in. Authenticate this provider to read quota.";
    } else if (firstProbeFailure) {
      status = "error";
      errorMessage = firstProbeFailure;
      reason = firstProbeFailure;
    } else if (firstUnsupported) {
      status = "unavailable";
      reason = firstUnsupported;
    } else {
      status = "unavailable";
      reason = "No quota windows reported by this provider.";
    }
  }

  return {
    platformId: adapter.platformId,
    platformName: adapter.platformName,
    driverKind: adapter.driverKind,
    accentColor: adapter.accentColor,
    status,
    accounts,
    windows: finalWindows,
    source: sourceLabel,
    updatedAt,
    stale,
    reason,
    errorMessage,
    externalUsageUrl,
    raw: limitsList.filter(Boolean),
  };
}
