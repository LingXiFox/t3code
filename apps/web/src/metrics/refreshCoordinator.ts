export const VISIBLE_AUTO_REFRESH_INTERVAL_MS = 5 * 60_000;
export const HIDDEN_AUTO_REFRESH_INTERVAL_MS = 15 * 60_000;
export const INITIAL_BACKOFF_MS = 60_000;
const MAX_BACKOFF_MS = 15 * 60_000;

export interface RefreshCoordinatorState {
  readonly refreshing: boolean;
  readonly lastRefreshedAtMs: number | null;
  readonly lastError: string | null;
  readonly consecutiveFailures: number;
  readonly backoffUntilMs: number | null;
}

export class MetricsRefreshCoordinator {
  private inflight: Promise<void> | null = null;
  private state: RefreshCoordinatorState = {
    refreshing: false,
    lastRefreshedAtMs: null,
    lastError: null,
    consecutiveFailures: 0,
    backoffUntilMs: null,
  };
  private listeners = new Set<() => void>();

  constructor(private readonly now: () => number = () => Date.now()) {}

  getSnapshot(): RefreshCoordinatorState {
    return this.state;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(patch: Partial<RefreshCoordinatorState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) {
      listener();
    }
  }

  effectiveIntervalMs(isDocumentVisible: boolean): number {
    return isDocumentVisible ? VISIBLE_AUTO_REFRESH_INTERVAL_MS : HIDDEN_AUTO_REFRESH_INTERVAL_MS;
  }

  shouldAutoRefresh(isDocumentVisible: boolean): boolean {
    const nowMs = this.now();
    if (this.inflight !== null) return false;
    if (this.state.backoffUntilMs !== null && nowMs < this.state.backoffUntilMs) {
      return false;
    }
    if (this.state.lastRefreshedAtMs === null) return true;
    return nowMs - this.state.lastRefreshedAtMs >= this.effectiveIntervalMs(isDocumentVisible);
  }

  /**
   * Deduplicates concurrent refreshes. Manual refreshes bypass backoff timers
   * while still sharing any active in-flight request.
   */
  async refresh(task: () => Promise<void>, options?: { readonly manual?: boolean }): Promise<void> {
    if (this.inflight) {
      return this.inflight;
    }
    const nowMs = this.now();
    if (
      !options?.manual &&
      this.state.backoffUntilMs !== null &&
      nowMs < this.state.backoffUntilMs
    ) {
      return;
    }

    this.emit({ refreshing: true });
    const run = (async () => {
      try {
        await task();
        this.emit({
          refreshing: false,
          lastRefreshedAtMs: this.now(),
          lastError: null,
          consecutiveFailures: 0,
          backoffUntilMs: null,
        });
      } catch (error: unknown) {
        const nextFailures = this.state.consecutiveFailures + 1;
        const backoffMs = Math.min(
          MAX_BACKOFF_MS,
          INITIAL_BACKOFF_MS * Math.pow(2, Math.max(0, nextFailures - 1)),
        );
        const message =
          error instanceof Error ? error.message : "Failed to refresh provider quotas.";
        this.emit({
          refreshing: false,
          lastError: message,
          consecutiveFailures: nextFailures,
          backoffUntilMs: this.now() + backoffMs,
        });
      } finally {
        this.inflight = null;
      }
    })();

    this.inflight = run;
    return run;
  }
}

export const sharedMetricsRefreshCoordinator = new MetricsRefreshCoordinator();
