import { ProviderDriverKind } from "@t3tools/contracts";

import {
  buildStandardPlatformSnapshot,
  collectDriverSources,
  type QuotaPlatformAdapter,
} from "./shared";

export const museQuotaAdapter: QuotaPlatformAdapter = {
  platformId: "muse",
  driverKind: ProviderDriverKind.make("muse"),
  platformName: "Muse Code",
  accentColor: "#0866ff",
  collect({ presentations, nowMs }) {
    const sources = collectDriverSources(presentations, this.driverKind);
    return buildStandardPlatformSnapshot({
      adapter: this,
      sources,
      nowMs,
      // oxlint-disable-next-line t3code/no-untranslated-copy -- Technical adapter data source identifier
      sourceLabel: "Muse Live Session Usage",
      unavailableOverride: ({ providers }) => {
        const authenticated = providers.some(
          (entry) => entry.provider.auth.status === "authenticated",
        );
        if (authenticated) {
          return {
            status: "unavailable",
            reason: "Awaiting first live session usage/changed event from Muse Code.",
          };
        }
        return null;
      },
    });
  },
};
