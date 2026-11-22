import { describe, expect, it, vi } from "vite-plus/test";

import {
  HIDDEN_AUTO_REFRESH_INTERVAL_MS,
  INITIAL_BACKOFF_MS,
  MetricsRefreshCoordinator,
  VISIBLE_AUTO_REFRESH_INTERVAL_MS,
} from "./refreshCoordinator";

describe("MetricsRefreshCoordinator", () => {
  it("deduplicates concurrent refreshes so only one request runs", async () => {
    let currentMs = 1_000_000;
    const coordinator = new MetricsRefreshCoordinator(() => currentMs);
    let resolveTask!: () => void;
    const task = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveTask = resolve;
        }),
    );

    const first = coordinator.refresh(task);
    const second = coordinator.refresh(task);
    expect(task).toHaveBeenCalledTimes(1);
    expect(coordinator.getSnapshot().refreshing).toBe(true);

    currentMs += 500;
    resolveTask();
    await Promise.all([first, second]);

    expect(coordinator.getSnapshot().refreshing).toBe(false);
    expect(coordinator.getSnapshot().lastRefreshedAtMs).toBe(1_000_500);
  });

  it("applies exponential backoff on failures and allows manual refresh override", async () => {
    let currentMs = 10_000_000;
    const coordinator = new MetricsRefreshCoordinator(() => currentMs);

    await coordinator.refresh(async () => {
      throw new Error("429 Too Many Requests");
    });

    expect(coordinator.getSnapshot().consecutiveFailures).toBe(1);
    expect(coordinator.getSnapshot().backoffUntilMs).toBe(currentMs + INITIAL_BACKOFF_MS);
    expect(coordinator.shouldAutoRefresh(true)).toBe(false);

    // Second automatic attempt during backoff is skipped
    const skippedTask = vi.fn(async () => {});
    await coordinator.refresh(skippedTask, { manual: false });
    expect(skippedTask).not.toHaveBeenCalled();

    // Manual refresh bypasses backoff and resets failure counter on success
    const manualTask = vi.fn(async () => {});
    await coordinator.refresh(manualTask, { manual: true });
    expect(manualTask).toHaveBeenCalledTimes(1);
    expect(coordinator.getSnapshot().consecutiveFailures).toBe(0);
    expect(coordinator.getSnapshot().backoffUntilMs).toBeNull();
  });

  it("uses longer auto-refresh intervals when the page is hidden", () => {
    let currentMs = 10_000_000;
    const coordinator = new MetricsRefreshCoordinator(() => currentMs);
    expect(coordinator.effectiveIntervalMs(true)).toBe(VISIBLE_AUTO_REFRESH_INTERVAL_MS);
    expect(coordinator.effectiveIntervalMs(false)).toBe(HIDDEN_AUTO_REFRESH_INTERVAL_MS);
  });
});
