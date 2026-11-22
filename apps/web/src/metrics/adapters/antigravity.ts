import { ProviderDriverKind } from "@t3tools/contracts";

import {
  buildStandardPlatformSnapshot,
  collectDriverSources,
  type QuotaPlatformAdapter,
} from "./shared";

export const antigravityQuotaAdapter: QuotaPlatformAdapter = {
  platformId: "antigravity",
  driverKind: ProviderDriverKind.make("antigravity"),
  platformName: "Antigravity",
  accentColor: "#8c7bd1",
  collect({ presentations, nowMs }) {
    const sources = collectDriverSources(presentations, this.driverKind);
    return buildStandardPlatformSnapshot({
      adapter: this,
      sources,
      nowMs,
      // oxlint-disable-next-line t3code/no-untranslated-copy -- Technical adapter data source identifier
      sourceLabel: "Antigravity Multi-Pool Quota",
      transformWindows: (windows) =>
        [...windows].sort((left, right) => {
          const leftGemini = Number(!left.id.startsWith("gemini-"));
          const rightGemini = Number(!right.id.startsWith("gemini-"));
          if (leftGemini !== rightGemini) return leftGemini - rightGemini;
          return left.id.localeCompare(right.id);
        }),
    });
  },
};
