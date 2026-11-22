import { ProviderDriverKind } from "@t3tools/contracts";

import {
  buildStandardPlatformSnapshot,
  collectDriverSources,
  type QuotaPlatformAdapter,
} from "./shared";

export const codexQuotaAdapter: QuotaPlatformAdapter = {
  platformId: "codex",
  driverKind: ProviderDriverKind.make("codex"),
  platformName: "OpenAI Codex",
  accentColor: "#f7f1e8",
  collect({ presentations, nowMs }) {
    const sources = collectDriverSources(presentations, this.driverKind);
    return buildStandardPlatformSnapshot({
      adapter: this,
      sources,
      nowMs,
      // oxlint-disable-next-line t3code/no-untranslated-copy -- Technical adapter data source identifier
      sourceLabel: "Codex App Server / Rate Limits",
      transformWindows: (windows) =>
        windows.map((win) => ({
          ...win,
          poolName:
            win.id === "primary"
              ? "Codex 5h"
              : win.id === "secondary"
                ? "Codex Weekly"
                : win.id === "individual"
                  ? "Workspace Credits"
                  : win.poolName,
        })),
    });
  },
};
