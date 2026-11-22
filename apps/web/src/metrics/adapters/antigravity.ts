import { ProviderDriverKind } from "@t3tools/contracts";

import { antigravityPoolGroup, normalizePoolLabel } from "../providerPools";
import {
  buildStandardPlatformSnapshot,
  collectDriverSources,
  type QuotaPlatformAdapter,
} from "./shared";

const GROUP_RANK = {
  gemini: 0,
  shared: 1,
  argon: 2,
  carbon: 3,
  other: 4,
} as const;

const KIND_RANK = {
  "5h": 0,
  daily: 1,
  weekly: 2,
  monthly: 3,
  custom: 4,
} as const;

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
        [...windows]
          .map((win) => ({
            ...win,
            poolName: normalizePoolLabel(this.driverKind, {
              id: win.id,
              label: win.label,
              kind:
                win.windowKind === "5h"
                  ? "session"
                  : win.windowKind === "weekly"
                    ? "weekly"
                    : win.windowKind === "monthly"
                      ? "monthly"
                      : "other",
            }),
          }))
          .sort((left, right) => {
            const leftGroup = GROUP_RANK[antigravityPoolGroup(left.id)];
            const rightGroup = GROUP_RANK[antigravityPoolGroup(right.id)];
            if (leftGroup !== rightGroup) return leftGroup - rightGroup;
            const kindDiff = KIND_RANK[left.windowKind] - KIND_RANK[right.windowKind];
            if (kindDiff !== 0) return kindDiff;
            return left.id.localeCompare(right.id);
          }),
    });
  },
};
