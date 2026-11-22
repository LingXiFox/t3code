#!/usr/bin/env python3
# Derived from Deepusleepy/t3-nyx-theme (MIT License, Copyright (c) 2026 Deepusleepy)
import json
import re
import sys
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).parent
NIGHT_SKY_DIR = ROOT / "night-sky"
GENERATED_DIR = ROOT / "generated"

sys.path.insert(0, str(NIGHT_SKY_DIR))
from art import Sky, build_art_data_url  # noqa: E402

CSS_LIMIT = 20_000


@dataclass(frozen=True)
class ThemeSpec:
    id: str
    const_prefix: str
    name: str
    sources: tuple[str, ...]
    sky: Sky
    plus_pressed: str


LINGXI_NIGHT_SKY = ThemeSpec(
    id="lingxi-night-sky",
    const_prefix="LINGXI_NIGHT_SKY",
    name="LingXi Night Sky",
    sources=("theme.css", "plus.css"),
    sky=Sky(336, 189, seed=8, speckles=False),
    plus_pressed=",[data-model-picker-sidebar] [aria-pressed=true]",
)

# Complete 61-role palette in Fox Orange / Charcoal Black / Cream White.
COLORS = {
    "canvas": "#000000",
    "chrome": "#000000",
    "toolbar": "#000000",
    "toolbarForeground": "#f7f1e8",
    "toolbarBorder": "#1f1916",
    "toolbarControl": "#140f0c",
    "toolbarControlForeground": "#f7f1e8",
    "toolbarControlHover": "#241913",
    "surface": "#100c0a",
    "surfaceRaised": "#16110e",
    "surfaceOverlay": "#0c0908",
    "text": "#f7f1e8",
    "textMuted": "#b8aba0",
    "border": "#261d18",
    "input": "#2b1e17",
    "focus": "#f07c38",
    "accent": "#f07c38",
    "accentForeground": "#140b06",
    "secondary": "#1c1410",
    "secondaryForeground": "#f7f1e8",
    "muted": "#211712",
    "mutedForeground": "#b8aba0",
    "placeholder": "#8c7f74",
    "secondaryLabel": "#b8aba0",
    "iconMuted": "#b8aba0",
    "error": "#fb414a",
    "errorForeground": "#ff7a7a",
    "errorSurface": "#321416",
    "warning": "#fe9a00",
    "warningForeground": "#ffb900",
    "warningSurface": "#332108",
    "update": "#f07c38",
    "updateForeground": "#ffb478",
    "updateSurface": "#29180f",
    "accentSurface": "#291a12",
    "accentSurfaceForeground": "#f7f1e8",
    "messageSurface": "#241812",
    "messageForeground": "#f7f1e8",
    "messageAction": "#e86e28",
    "messageActionForeground": "#fffaf5",
    "messageActionHover": "#f08546",
    "codeBackground": "#0b0807",
    "codeForeground": "#f7f1e8",
    "searchMatchBackground": "#735412",
    "searchMatchForeground": "#f7f1e8",
    "searchMatchActiveBackground": "#eea52b",
    "searchMatchActiveForeground": "#21180a",
    "sidebar": "#000000",
    "sidebarForeground": "#f7f1e8",
    "sidebarMutedForeground": "#ab9e93",
    "sidebarControlSurface": "#0a0807",
    "sidebarRowHover": "#1c1410",
    "sidebarRowActive": "#261b14",
    "sidebarRowSelected": "#2b1d14",
    "sidebarBorder": "#191412",
    "terminalBackground": "#080605",
    "terminalForeground": "#f7f1e8",
    "terminalCursor": "#ffb478",
    "terminalSelection": "#4d2a16",
    "terminalScrollbar": "#2e221b",
    "terminalScrollbarHover": "#473327",
}

SHORT_VARIABLES = {
    "--lx-key-glow": "--kg",
    "--lx-key-rim": "--kr",
    "--lx-key": "--k",
    "--lx-art-width": "--w",
    "--lx-sheen-edge": "--s",
    "--lx-grid": "--g",
    "--lx-dot": "--d",
    "--lx-art": "--a",
    "--lx-sky": "--b",
    "--lx-shine": "--h",
}


def minify(css: str) -> str:
    strings: list[str] = []

    def stash(match: re.Match[str]) -> str:
        strings.append(match.group(0))
        return f"\x00{len(strings) - 1}\x00"

    css = re.sub(r"/\*.*?\*/", "", css, flags=re.S)
    css = re.sub(r'="([A-Za-z_][\w-]*)"\]', r"=\1]", css)
    css = re.sub(r'"[^"]*"|url\(data:[^)]*\)', stash, css)
    css = re.sub(r"\s+", " ", css)
    css = re.sub(r"\s*([{};,>])\s*", r"\1", css)
    css = re.sub(r":\s+", ":", css)
    css = re.sub(r"\s*!important", "!important", css)
    css = re.sub(r" ([*/]) ", r"\1", css)
    css = css.replace(";}", "}")
    css = re.sub(r"\btransparent\b", "#0000", css)
    css = re.sub(
        r"#([0-9a-f])\1([0-9a-f])\2([0-9a-f])\3(([0-9a-f])\5)?\b",
        lambda m: "#" + m.group(1) + m.group(2) + m.group(3) + (m.group(5) or ""),
        css,
        flags=re.I,
    )
    css = re.sub(r"\s*([<>])\s*", r"\1", css)
    css = re.sub(r"(?<![\w.])0\.(\d)", r".\1", css)
    for long_name in sorted(SHORT_VARIABLES, key=len, reverse=True):
        css = css.replace(long_name, SHORT_VARIABLES[long_name])
    css = re.sub(r"(?<=[{};,])&(?: |(?=>))", "", css)
    css = re.sub(r"\x00(\d+)\x00", lambda m: strings[int(m.group(1))], css)
    return css.strip()


def build_theme_payload(theme: ThemeSpec) -> dict[str, object]:
    css = minify("\n".join((NIGHT_SKY_DIR / source).read_text(encoding="utf-8") for source in theme.sources))
    css = (
        css.replace("__PLUS_PRESSED__", theme.plus_pressed)
        .replace("__ART_WIDTH__", str(theme.sky.width))
        .replace("__ART__", build_art_data_url(theme.sky))
    )
    if len(css) > CSS_LIMIT:
        sys.exit(f"{theme.id} css is {len(css)} characters; limit is {CSS_LIMIT}")
    if 'content:"T3"' in css or "content:'T3'" in css:
        sys.exit(f"{theme.id} css still contains upstream T3 watermark")
    if 'content:"LINGXIFOX"' not in css:
        sys.exit(f"{theme.id} css is missing LINGXIFOX watermark")
    return {
        "id": theme.id,
        "label": theme.name,
        "appearance": "dark",
        "colors": COLORS,
        "css": css,
    }


def render_ts_module(theme: ThemeSpec, payload: dict[str, object]) -> str:
    colors = payload["colors"]
    assert isinstance(colors, dict)
    color_lines = "\n".join(f"    {role}: {json.dumps(value)}," for role, value in colors.items())
    boot_palette = {
        "background": colors["canvas"],
        "foreground": colors["text"],
        "accent": colors["accent"],
        "chrome": colors["chrome"],
    }
    return (
        "// Generated by apps/web/src/themes/lingxi/build.py — do not edit manually.\n"
        "// Derived from Deepusleepy/t3-nyx-theme (MIT License, Copyright (c) 2026 Deepusleepy).\n"
        'import type { ThemeDefinition } from "@t3tools/shared/themePalettes";\n\n'
        f"export const {theme.const_prefix}_THEME_ID = {json.dumps(theme.id)} as const;\n\n"
        f"export const {theme.const_prefix}_BOOT_PALETTE = {{\n"
        f"  background: {json.dumps(boot_palette['background'])},\n"
        f"  foreground: {json.dumps(boot_palette['foreground'])},\n"
        f"  accent: {json.dumps(boot_palette['accent'])},\n"
        f"  chrome: {json.dumps(boot_palette['chrome'])},\n"
        "} as const;\n\n"
        f"export const {theme.const_prefix}_THEME: ThemeDefinition = {{\n"
        f"  id: {theme.const_prefix}_THEME_ID,\n"
        "  // oxlint-disable-next-line t3code/no-untranslated-copy -- Proper noun theme name\n"
        f"  label: {json.dumps(payload['label'])},\n"
        f"  appearance: {json.dumps(payload['appearance'])},\n"
        "  colors: {\n"
        f"{color_lines}\n"
        "  },\n"
        f"  css: {json.dumps(payload['css'])},\n"
        "};\n"
    )


if __name__ == "__main__":
    GENERATED_DIR.mkdir(parents=True, exist_ok=True)
    payload = build_theme_payload(LINGXI_NIGHT_SKY)
    out = GENERATED_DIR / f"{LINGXI_NIGHT_SKY.id}.ts"
    out.write_text(render_ts_module(LINGXI_NIGHT_SKY, payload), encoding="utf-8")
    css_text = str(payload["css"])
    print(f"{out.relative_to(ROOT)}: {len(css_text)} css characters (limit {CSS_LIMIT})")
