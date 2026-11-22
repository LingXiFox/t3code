import { ProviderDriverKind } from "@t3tools/contracts";

import {
  buildStandardPlatformSnapshot,
  collectDriverSources,
  type QuotaPlatformAdapter,
} from "./shared";

export const claudeQuotaAdapter: QuotaPlatformAdapter = {
  platformId: "claude",
  driverKind: ProviderDriverKind.make("claudeAgent"),
  platformName: "Claude Code",
  accentColor: "#d97757",
  collect({ presentations, nowMs }) {
    const sources = collectDriverSources(presentations, this.driverKind);
    return buildStandardPlatformSnapshot({
      adapter: this,
      sources,
      nowMs,
      // oxlint-disable-next-line t3code/no-untranslated-copy -- Technical adapter data source identifier
      sourceLabel: "Claude Agent SDK Usage",
      transformWindows: (windows) =>
        windows.map((win) => ({
          ...win,
          poolName:
            win.id === "five_hour"
              ? "Claude 5h"
              : win.id === "seven_day"
                ? "Claude Weekly"
                : win.label,
        })),
      unavailableOverride: ({ firstLimits }) =>
        firstLimits?.zeroSpendCap
          ? {
              status: "unavailable",
              reason: "Spend cap is $0; no percentage quota window is active.",
            }
          : null,
    });
  },
};
