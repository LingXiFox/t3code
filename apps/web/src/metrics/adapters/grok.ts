import { ProviderDriverKind } from "@t3tools/contracts";

import {
  buildStandardPlatformSnapshot,
  collectDriverSources,
  type QuotaPlatformAdapter,
} from "./shared";

export const grokQuotaAdapter: QuotaPlatformAdapter = {
  platformId: "grok",
  driverKind: ProviderDriverKind.make("grok"),
  platformName: "Grok",
  accentColor: "#a3a3a3",
  collect({ presentations, nowMs }) {
    const sources = collectDriverSources(presentations, this.driverKind);
    return buildStandardPlatformSnapshot({
      adapter: this,
      sources,
      nowMs,
      // oxlint-disable-next-line t3code/no-untranslated-copy -- Technical adapter data source identifier
      sourceLabel: "Grok CLI Billing Credits",
      unavailableOverride: ({ providers, firstLimits }) => {
        if (firstLimits?.unavailable?.message) {
          return {
            status: firstLimits.unavailable.reason === "probeFailed" ? "error" : "unavailable",
            reason: firstLimits.unavailable.message,
          };
        }
        const authenticated = providers.some(
          (entry) => entry.provider.auth.status === "authenticated",
        );
        if (authenticated && firstLimits?.unavailable?.reason === "unsupported") {
          return {
            status: "unavailable",
            reason:
              "API-key mode tracks session token usage only; subscription quota is unavailable.",
          };
        }
        return null;
      },
    });
  },
};
