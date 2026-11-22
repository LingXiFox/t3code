import { ProviderDriverKind } from "@t3tools/contracts";

import {
  buildStandardPlatformSnapshot,
  collectDriverSources,
  type QuotaPlatformAdapter,
} from "./shared";

export const cursorQuotaAdapter: QuotaPlatformAdapter = {
  platformId: "cursor",
  driverKind: ProviderDriverKind.make("cursor"),
  platformName: "Cursor",
  accentColor: "#8b8b8b",
  collect({ presentations, nowMs }) {
    const sources = collectDriverSources(presentations, this.driverKind);
    return buildStandardPlatformSnapshot({
      adapter: this,
      sources,
      nowMs,
      // oxlint-disable-next-line t3code/no-untranslated-copy -- Technical adapter data source identifier
      sourceLabel: "Cursor Dashboard Usage",
      transformWindows: (windows) => {
        const hasAuto = windows.some((w) => w.id === "autoPercentUsed");
        const hasApi = windows.some((w) => w.id === "apiPercentUsed");
        return windows
          .filter((w) => !(hasAuto && hasApi && w.id === "totalPercentUsed"))
          .map((w) => ({
            ...w,
            poolName:
              w.id === "autoPercentUsed"
                ? "Cursor Models"
                : w.id === "apiPercentUsed"
                  ? "Other Models"
                  : w.id === "totalPercentUsed"
                    ? "Overall Plan"
                    : w.poolName,
          }));
      },
    });
  },
};
