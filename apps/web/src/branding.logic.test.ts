import { describe, expect, it } from "vite-plus/test";

import { formatAppDisplayName, resolveWebAppStageLabel, splitAppBrandName } from "./branding.logic";

describe("branding.logic", () => {
  it("splits LingXi T3 and fallback names cleanly", () => {
    expect(splitAppBrandName("LingXi T3")).toEqual({
      primary: "LingXi",
      secondary: "T3",
    });
    expect(splitAppBrandName("T3 Code")).toEqual({
      primary: "T3",
      secondary: "Code",
    });
    expect(splitAppBrandName("LingXi")).toEqual({
      primary: "LingXi",
      secondary: null,
    });
  });

  it("formats LingXi T3 display name with Dev, Nightly, and Latest stage labels", () => {
    expect(
      formatAppDisplayName({
        baseName: "LingXi T3",
        stageLabel: resolveWebAppStageLabel({ hostedAppChannel: null, development: true }),
      }),
    ).toBe("LingXi T3 (Dev)");
    expect(
      formatAppDisplayName({
        baseName: "LingXi T3",
        stageLabel: resolveWebAppStageLabel({ hostedAppChannel: "nightly", development: false }),
      }),
    ).toBe("LingXi T3 (Nightly)");
    expect(
      formatAppDisplayName({
        baseName: "LingXi T3",
        stageLabel: resolveWebAppStageLabel({ hostedAppChannel: "latest", development: false }),
      }),
    ).toBe("LingXi T3");
  });
});
