import type { ThemeDefinition } from "@t3tools/shared/themePalettes";

import {
  LINGXI_NIGHT_SKY_BOOT_PALETTE,
  LINGXI_NIGHT_SKY_THEME,
  LINGXI_NIGHT_SKY_THEME_ID,
} from "./generated/lingxi-night-sky";

export { LINGXI_NIGHT_SKY_BOOT_PALETTE, LINGXI_NIGHT_SKY_THEME, LINGXI_NIGHT_SKY_THEME_ID };

export const LINGXI_DEFAULT_THEME_ID = LINGXI_NIGHT_SKY_THEME_ID;

/** Extensible registry for LingXi built-in themes (dark and future standalone light themes). */
export const LINGXI_BUILT_IN_THEMES: ReadonlyArray<ThemeDefinition> = [LINGXI_NIGHT_SKY_THEME];

export const LINGXI_RESERVED_THEME_IDS: ReadonlySet<string> = new Set(
  LINGXI_BUILT_IN_THEMES.map((theme) => theme.id),
);
