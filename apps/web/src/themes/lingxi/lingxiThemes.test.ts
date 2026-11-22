import { THEME_CSS_MAX_LENGTH } from "@t3tools/contracts";
import { themeCssLoadsRemoteFiles } from "@t3tools/shared/themeCss";
import { THEME_COLOR_ROLES, type ThemeDefinition } from "@t3tools/shared/themePalettes";
import { describe, expect, it, vi } from "vite-plus/test";

import {
  ALL_BUILT_IN_THEMES,
  getThemeDefinition,
  getThemeModes,
  isReservedThemeId,
  LINGXI_BUILT_IN_THEMES,
  LINGXI_DEFAULT_THEME_ID,
  LINGXI_NIGHT_SKY_THEME,
  parseThemeFile,
  serializeThemeFile,
  singleAppearanceOf,
  THEME_APPEARANCE_MODE_STORAGE_KEY,
  THEME_FOLLOW_SYSTEM_STORAGE_KEY,
  THEME_HALVES_STORAGE_KEY,
  toCanonicalThemeColor,
} from "../../themePalette";
import { LINGXI_NIGHT_SKY_BOOT_PALETTE, LINGXI_NIGHT_SKY_THEME_ID } from "./index";
import { readAppearanceModePreference, readThemePreference } from "../../hooks/useTheme";

function createStorageMock(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
  };
}

describe("LingXi built-in theme system", () => {
  it("defines LingXi Night Sky with complete roles, branding, Nyx Plus selectors, and CSS limits", () => {
    expect(LINGXI_DEFAULT_THEME_ID).toBe("lingxi-night-sky");
    expect(LINGXI_NIGHT_SKY_THEME_ID).toBe("lingxi-night-sky");
    expect(LINGXI_NIGHT_SKY_BOOT_PALETTE).toEqual({
      background: LINGXI_NIGHT_SKY_THEME.colors.canvas,
      foreground: LINGXI_NIGHT_SKY_THEME.colors.text,
      accent: LINGXI_NIGHT_SKY_THEME.colors.accent,
      chrome: LINGXI_NIGHT_SKY_THEME.colors.chrome,
    });
    expect(LINGXI_NIGHT_SKY_THEME.id).toBe("lingxi-night-sky");
    expect(LINGXI_NIGHT_SKY_THEME.label).toBe("LingXi Night Sky");
    expect(LINGXI_NIGHT_SKY_THEME.appearance).toBe("dark");
    expect(LINGXI_BUILT_IN_THEMES).toContain(LINGXI_NIGHT_SKY_THEME);
    expect(ALL_BUILT_IN_THEMES[0]).toBe(LINGXI_NIGHT_SKY_THEME);
    expect(isReservedThemeId("lingxi-night-sky")).toBe(true);
    expect(getThemeDefinition("lingxi-night-sky")).toBe(LINGXI_NIGHT_SKY_THEME);

    for (const role of THEME_COLOR_ROLES) {
      expect(toCanonicalThemeColor(LINGXI_NIGHT_SKY_THEME.colors[role])).not.toBeNull();
    }

    const css = LINGXI_NIGHT_SKY_THEME.css ?? "";
    expect(css.length).toBeGreaterThan(0);
    expect(css.length).toBeLessThanOrEqual(20_000);
    expect(css.length).toBeLessThanOrEqual(THEME_CSS_MAX_LENGTH);
    expect(themeCssLoadsRemoteFiles(css)).toBe(false);
    expect(css).toContain('content:"LINGXIFOX"');
    expect(css).not.toContain('content:"T3"');
    expect(css).not.toContain("content:'T3'");
    expect(css).toContain("[data-sidebar-row]");
    expect(css).toContain("[data-model-picker-content]");
    expect(css).toContain("[data-model-picker-effort]");
  });

  it("defaults fresh installs to LingXi Night Sky in dark mode without overwriting existing preferences", () => {
    vi.stubGlobal("window", {
      localStorage: createStorageMock(),
      matchMedia: () => ({ matches: false }),
    });
    try {
      const freshTheme = readThemePreference();
      expect(freshTheme).toBe("lingxi-night-sky");
      expect(readAppearanceModePreference(freshTheme)).toBe("dark");
    } finally {
      vi.unstubAllGlobals();
    }

    for (const [storage, expectedTheme] of [
      [{ "t3code:theme": "system" }, "system"],
      [{ "t3code:theme": "light" }, "light"],
      [{ "t3code:theme": "t3-chat" }, "t3-chat"],
      [{ "t3code:theme": "grove" }, "grove"],
      [{ [THEME_APPEARANCE_MODE_STORAGE_KEY]: "light" }, "system"],
      [{ [THEME_FOLLOW_SYSTEM_STORAGE_KEY]: "false" }, "system"],
      [{ [THEME_HALVES_STORAGE_KEY]: JSON.stringify({ dark: "grove" }) }, "system"],
    ] as const) {
      vi.stubGlobal("window", {
        localStorage: createStorageMock(storage),
        matchMedia: () => ({ matches: false }),
      });
      try {
        expect(readThemePreference()).toBe(expectedTheme);
      } finally {
        vi.unstubAllGlobals();
      }
    }
  });

  it("supports exporting LingXi Night Sky and re-importing as a renamed custom theme", () => {
    const exportedJson = serializeThemeFile(LINGXI_NIGHT_SKY_THEME);
    const parsedExport = JSON.parse(exportedJson) as Record<string, unknown>;
    expect(parsedExport.id).toBe("lingxi-night-sky");
    expect(parsedExport.name).toBe("LingXi Night Sky");
    expect(parsedExport.appearance).toBe("dark");

    // Reserved built-in id cannot be overwritten on import.
    expect(() => parseThemeFile(parsedExport)).toThrow();

    // Importing a renamed copy succeeds cleanly with full CSS and palette preserved.
    const importedCopy = parseThemeFile({
      ...parsedExport,
      id: "lingxi-night-sky-copy",
      name: "LingXi Night Sky Copy",
    });
    expect(importedCopy.id).toBe("lingxi-night-sky-copy");
    expect(importedCopy.css).toBe(LINGXI_NIGHT_SKY_THEME.css);
  });

  it("supports standalone light themes in the same built-in theme registry", () => {
    const futureLightTheme: ThemeDefinition = {
      id: "lingxi-daylight",
      label: "LingXi Daylight",
      appearance: "light",
      colors: LINGXI_NIGHT_SKY_THEME.colors,
    };
    expect(getThemeModes(LINGXI_NIGHT_SKY_THEME)).toEqual(["dark"]);
    expect(singleAppearanceOf(LINGXI_NIGHT_SKY_THEME)).toBe("dark");
    expect(getThemeModes(futureLightTheme)).toEqual(["light"]);
    expect(singleAppearanceOf(futureLightTheme)).toBe("light");
  });
});
