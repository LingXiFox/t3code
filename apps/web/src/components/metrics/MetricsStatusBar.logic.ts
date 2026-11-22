import type { QuotaPlatformSnapshot, QuotaPoolWindow, QuotaStatus } from "../../metrics/types";

export function formatCompactTokens(tokens: number | null | undefined): string {
  if (tokens === null || tokens === undefined || !Number.isFinite(tokens)) return "--";
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
  return String(Math.round(tokens));
}

export function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "--";
  return `${Math.round(Math.max(0, Math.min(100, value)))}%`;
}

export function formatDurationCompact(durationMs: number | null | undefined): string {
  if (durationMs === null || durationMs === undefined || !Number.isFinite(durationMs)) return "--";
  if (durationMs < 1_000) return `${Math.round(durationMs)}ms`;
  const seconds = durationMs / 1_000;
  if (seconds < 60) return `${seconds.toFixed(1).replace(/\.0$/, "")}s`;
  const mins = Math.floor(seconds / 60);
  const remSec = Math.round(seconds % 60);
  return remSec > 0 ? `${mins}m ${remSec}s` : `${mins}m`;
}

export function formatResetCountdown(resetsAt: string | null, nowMs: number): string | null {
  if (!resetsAt) return null;
  const targetMs = Date.parse(resetsAt);
  if (!Number.isFinite(targetMs)) return null;
  const diffMs = Math.max(0, targetMs - nowMs);
  const totalMins = Math.round(diffMs / 60_000);
  if (totalMins < 60) return `${totalMins}m`;
  const hours = Math.floor(totalMins / 60);
  const mins = totalMins % 60;
  if (hours < 24) return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  return remHours > 0 ? `${days}d ${remHours}h` : `${days}d`;
}

export function lowestRemainingWindow(windows: readonly QuotaPoolWindow[]): QuotaPoolWindow | null {
  let lowest: QuotaPoolWindow | null = null;
  for (const win of windows) {
    if (win.remainingPercent === null) continue;
    if (!lowest || (lowest.remainingPercent ?? 101) > win.remainingPercent) {
      lowest = win;
    }
  }
  return lowest ?? windows[0] ?? null;
}

export function quotaBarTone(remainingPercent: number | null): "normal" | "warning" | "error" {
  if (remainingPercent === null) return "normal";
  if (remainingPercent <= 10) return "error";
  if (remainingPercent <= 20) return "warning";
  return "normal";
}

export function shortPlatformName(platformId: QuotaPlatformSnapshot["platformId"]): string {
  switch (platformId) {
    case "codex":
      return "Codex";
    case "claude":
      return "Claude";
    case "antigravity":
      return "Antigravity";
    case "cursor":
      return "Cursor";
    case "grok":
      return "Grok";
    case "muse":
      // oxlint-disable-next-line t3code/no-untranslated-copy -- Proper noun product name
      return "Muse";
  }
}

export function statusBadgeTone(status: QuotaStatus): "success" | "warning" | "error" | "muted" {
  switch (status) {
    case "available":
      return "success";
    case "partial":
    case "stale":
      return "warning";
    case "error":
    case "unauthorized":
      return "error";
    case "unavailable":
      return "muted";
  }
}
