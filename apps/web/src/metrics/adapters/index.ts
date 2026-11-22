import type { QuotaPlatformId, QuotaPlatformSnapshot } from "../types";
import { antigravityQuotaAdapter } from "./antigravity";
import { claudeQuotaAdapter } from "./claude";
import { codexQuotaAdapter } from "./codex";
import { cursorQuotaAdapter } from "./cursor";
import { grokQuotaAdapter } from "./grok";
import { museQuotaAdapter } from "./muse";
import type { AdapterCollectInput, QuotaPlatformAdapter } from "./shared";

export const QUOTA_PLATFORM_ADAPTERS: Readonly<Record<QuotaPlatformId, QuotaPlatformAdapter>> = {
  codex: codexQuotaAdapter,
  claude: claudeQuotaAdapter,
  antigravity: antigravityQuotaAdapter,
  cursor: cursorQuotaAdapter,
  grok: grokQuotaAdapter,
  muse: museQuotaAdapter,
};

/**
 * Collects quota snapshots across the requested platforms. Each adapter is
 * isolated in its own try/catch so a single failure never affects other platforms
 * or the main agent workspace.
 */
export function collectUnifiedQuotaMetrics(
  input: AdapterCollectInput & {
    readonly order: readonly QuotaPlatformId[];
  },
): readonly QuotaPlatformSnapshot[] {
  return input.order.map((platformId) => {
    const adapter = QUOTA_PLATFORM_ADAPTERS[platformId];
    try {
      return adapter.collect(input);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to collect platform quota.";
      return {
        platformId: adapter.platformId,
        platformName: adapter.platformName,
        driverKind: adapter.driverKind,
        accentColor: adapter.accentColor,
        status: "error",
        accounts: [],
        windows: [],
        source: "Adapter error boundary",
        updatedAt: null,
        stale: false,
        reason: message,
        errorMessage: message,
        externalUsageUrl: null,
      };
    }
  });
}
