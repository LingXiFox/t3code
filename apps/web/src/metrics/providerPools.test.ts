import { ProviderDriverKind, type ServerProviderUsageWindow } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  antigravityPoolGroup,
  computeLedBlockStates,
  normalizePoolLabel,
  partitionProviderWindows,
} from "./providerPools";

const AG_DRIVER = ProviderDriverKind.make("antigravity");
const CODEX_DRIVER = ProviderDriverKind.make("codex");
const CLAUDE_DRIVER = ProviderDriverKind.make("claudeAgent");
const CURSOR_DRIVER = ProviderDriverKind.make("cursor");

const ANTIGRAVITY_THREE_POOLS: readonly ServerProviderUsageWindow[] = [
  {
    id: "gemini-5h",
    kind: "session",
    label: "Gemini · 5-hour",
    usedPercent: 35,
    windowDurationMins: 300,
  },
  {
    id: "gemini-weekly",
    kind: "weekly",
    label: "Gemini · Weekly",
    usedPercent: 41,
    windowDurationMins: 10080,
  },
  {
    id: "3p-5h",
    kind: "session",
    label: "Claude & GPT (shared) · 5-hour",
    usedPercent: 0,
    windowDurationMins: 300,
  },
  {
    id: "3p-weekly",
    kind: "weekly",
    label: "Claude & GPT (shared) · Weekly",
    usedPercent: 0,
    windowDurationMins: 10080,
  },
  {
    id: "gemini-argon-weekly",
    kind: "weekly",
    label: "Gemini 4 Argon · Weekly",
    usedPercent: 0,
    windowDurationMins: 10080,
  },
];

describe("providerPools", () => {
  it("classifies Antigravity 3+ pools and dynamically partitions primary vs other pools by active model", () => {
    expect(antigravityPoolGroup("gemini-5h")).toBe("gemini");
    expect(antigravityPoolGroup("3p-weekly")).toBe("shared");
    expect(antigravityPoolGroup("gemini-argon-weekly")).toBe("argon");
    expect(antigravityPoolGroup("gemini-carbon-5h")).toBe("carbon");

    // Gemini model -> Gemini 5h & Weekly in primary, Claude & GPT + Argon in other
    const geminiView = partitionProviderWindows({
      driver: AG_DRIVER,
      model: "gemini-3.1-pro",
      windows: ANTIGRAVITY_THREE_POOLS,
    });
    expect(geminiView.primary.map((w) => w.id)).toEqual(["gemini-5h", "gemini-weekly"]);
    expect(geminiView.other.map((w) => w.id)).toEqual([
      "3p-5h",
      "3p-weekly",
      "gemini-argon-weekly",
    ]);

    // Claude/GPT model -> 3P shared windows promote to primary, Gemini & Argon move to other
    const claudeView = partitionProviderWindows({
      driver: AG_DRIVER,
      model: "claude-sonnet-4-5",
      windows: ANTIGRAVITY_THREE_POOLS,
    });
    expect(claudeView.primary.map((w) => w.id)).toEqual(["3p-5h", "3p-weekly"]);
    expect(claudeView.other.map((w) => w.id)).toEqual([
      "gemini-5h",
      "gemini-weekly",
      "gemini-argon-weekly",
    ]);

    // Argon model -> Gemini Argon promotes to primary
    const argonView = partitionProviderWindows({
      driver: AG_DRIVER,
      model: "gemini-4-argon",
      windows: ANTIGRAVITY_THREE_POOLS,
    });
    expect(argonView.primary.map((w) => w.id)).toEqual(["gemini-argon-weekly"]);
    expect(argonView.other).toHaveLength(4);
  });

  it("normalizes compact pool labels and partitions Codex, Claude, and Cursor pools", () => {
    expect(normalizePoolLabel(AG_DRIVER, ANTIGRAVITY_THREE_POOLS[0]!)).toBe("Gemini · 5h");
    expect(normalizePoolLabel(AG_DRIVER, ANTIGRAVITY_THREE_POOLS[2]!)).toBe("Claude & GPT · 5h");

    const codexView = partitionProviderWindows({
      driver: CODEX_DRIVER,
      model: "gpt-6-astra",
      windows: [
        { id: "primary", kind: "session", label: "Session", usedPercent: 3 },
        { id: "secondary", kind: "weekly", label: "Weekly", usedPercent: 86 },
        { id: "individual", kind: "other", label: "Credits", usedPercent: 10 },
      ],
    });
    expect(codexView.primary.map((w) => w.id)).toEqual(["primary", "secondary"]);
    expect(codexView.other.map((w) => w.id)).toEqual(["individual"]);

    const claudeView = partitionProviderWindows({
      driver: CLAUDE_DRIVER,
      model: "claude-opus-4-5",
      windows: [
        { id: "five_hour", kind: "session", label: "Session", usedPercent: 20 },
        { id: "seven_day", kind: "weekly", label: "Weekly", usedPercent: 30 },
        { id: "seven_day_sonnet", kind: "weekly", label: "Weekly · Sonnet", usedPercent: 10 },
      ],
    });
    expect(claudeView.primary.map((w) => w.id)).toEqual(["five_hour", "seven_day"]);
    expect(claudeView.other.map((w) => w.id)).toEqual(["seven_day_sonnet"]);

    const cursorView = partitionProviderWindows({
      driver: CURSOR_DRIVER,
      model: "composer-2",
      windows: [
        { id: "totalPercentUsed", kind: "monthly", label: "Overall", usedPercent: 40 },
        { id: "autoPercentUsed", kind: "monthly", label: "Cursor Models", usedPercent: 25 },
        { id: "apiPercentUsed", kind: "monthly", label: "Other Models", usedPercent: 55 },
      ],
    });
    expect(cursorView.primary.map((w) => w.id)).toEqual(["autoPercentUsed"]);
    expect(cursorView.other.map((w) => w.id)).toEqual(["apiPercentUsed"]);
  });

  it("computes 16-block LED states accurately", () => {
    const blocks59 = computeLedBlockStates(59, 16);
    expect(blocks59).toHaveLength(16);
    expect(blocks59.filter((s) => s === "full")).toHaveLength(9);
    expect(blocks59[9]).toBe("partial");
    expect(blocks59.slice(10).every((s) => s === "empty")).toBe(true);

    expect(computeLedBlockStates(100, 16).every((s) => s === "full")).toBe(true);
    expect(computeLedBlockStates(0, 16).every((s) => s === "empty")).toBe(true);
  });
});
