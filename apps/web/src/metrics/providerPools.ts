import type { ProviderDriverKind, ServerProviderUsageWindow } from "@t3tools/contracts";
import { antigravityWindowLimitsModel } from "@t3tools/shared/usageLimits";

export type AntigravityPoolGroup = "gemini" | "shared" | "argon" | "carbon" | "other";

export function antigravityPoolGroup(windowId: string): AntigravityPoolGroup {
  if (windowId.startsWith("gemini-argon-")) return "argon";
  if (windowId.startsWith("gemini-carbon-")) return "carbon";
  if (windowId.startsWith("gemini-")) return "gemini";
  if (windowId.startsWith("3p-") || windowId.startsWith("claude-") || windowId.startsWith("gpt-")) {
    return "shared";
  }
  return "other";
}

const ANTIGRAVITY_GROUP_ORDER: Record<AntigravityPoolGroup, number> = {
  gemini: 0,
  shared: 1,
  argon: 2,
  carbon: 3,
  other: 4,
};

const WINDOW_KIND_ORDER: Record<ServerProviderUsageWindow["kind"], number> = {
  session: 0,
  weekly: 1,
  monthly: 2,
  other: 3,
};

export function normalizePoolLabel(
  driver: ProviderDriverKind,
  window: Pick<ServerProviderUsageWindow, "id" | "label" | "kind">,
): string {
  if (driver === "antigravity") {
    return window.label
      .replace(/\s*\(shared\)/gi, "")
      .replace(/5-hour/gi, "5h")
      .trim();
  }
  if (driver === "codex") {
    if (window.id === "primary") return "Codex · 5h";
    // oxlint-disable-next-line t3code/no-untranslated-copy -- Provider pool identifier
    if (window.id === "secondary") return "Codex · Weekly";
    // oxlint-disable-next-line t3code/no-untranslated-copy -- Provider pool identifier
    if (window.id === "individual") return "Workspace Credits";
  }
  if (driver === "claudeAgent") {
    if (window.id === "five_hour") return "Claude · 5h";
    // oxlint-disable-next-line t3code/no-untranslated-copy -- Provider pool identifier
    if (window.id === "seven_day") return "Claude · Weekly";
  }
  if (driver === "cursor") {
    // oxlint-disable-next-line t3code/no-untranslated-copy -- Provider pool identifier
    if (window.id === "autoPercentUsed") return "Cursor Models";
    // oxlint-disable-next-line t3code/no-untranslated-copy -- Provider pool identifier
    if (window.id === "apiPercentUsed") return "Other Models";
    // oxlint-disable-next-line t3code/no-untranslated-copy -- Provider pool identifier
    if (window.id === "totalPercentUsed") return "Overall";
  }
  return window.label;
}

function compareByWindowKind<W extends Pick<ServerProviderUsageWindow, "id" | "kind">>(
  left: W,
  right: W,
): number {
  return (
    WINDOW_KIND_ORDER[left.kind] - WINDOW_KIND_ORDER[right.kind] || left.id.localeCompare(right.id)
  );
}

function compareAntigravityWindows<W extends Pick<ServerProviderUsageWindow, "id" | "kind">>(
  left: W,
  right: W,
): number {
  const leftGroup = ANTIGRAVITY_GROUP_ORDER[antigravityPoolGroup(left.id)];
  const rightGroup = ANTIGRAVITY_GROUP_ORDER[antigravityPoolGroup(right.id)];
  if (leftGroup !== rightGroup) return leftGroup - rightGroup;
  return compareByWindowKind(left, right);
}

export function partitionProviderWindows<
  W extends Pick<ServerProviderUsageWindow, "id" | "kind" | "label">,
>(input: {
  readonly driver: ProviderDriverKind;
  readonly model: string | null;
  readonly windows: readonly W[];
}): { readonly primary: readonly W[]; readonly other: readonly W[] } {
  const { driver, model, windows } = input;
  if (windows.length === 0) return { primary: [], other: [] };

  if (driver === "antigravity") {
    const sorted = [...windows].sort(compareAntigravityWindows);
    const hasNamedModelPool =
      model !== null && /^(gemini|claude|gpt)/.test(model.slice(model.lastIndexOf("/") + 1));
    const primary: W[] = [];
    const other: W[] = [];

    for (const win of sorted) {
      const matches = hasNamedModelPool
        ? antigravityWindowLimitsModel(win, model)
        : antigravityPoolGroup(win.id) === "gemini";
      if (matches) primary.push(win);
      else other.push(win);
    }

    if (primary.length === 0) {
      return { primary: sorted.slice(0, 2), other: sorted.slice(2) };
    }
    return { primary, other };
  }

  if (driver === "claudeAgent") {
    const scopeToken = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "_");
    const primary: W[] = [];
    const other: W[] = [];
    for (const win of [...windows].sort(compareByWindowKind)) {
      if (!win.id.startsWith("seven_day_")) {
        primary.push(win);
      } else {
        const suffix = win.id.slice("seven_day_".length);
        if (model !== null && scopeToken(model).includes(suffix)) {
          primary.push(win);
        } else {
          other.push(win);
        }
      }
    }
    return { primary, other };
  }

  if (driver === "codex") {
    const primary: W[] = [];
    const other: W[] = [];
    for (const win of [...windows].sort(compareByWindowKind)) {
      if (win.id === "individual") other.push(win);
      else primary.push(win);
    }
    return primary.length > 0 ? { primary, other } : { primary: other, other: [] };
  }

  if (driver === "cursor") {
    const hasAuto = windows.some((w) => w.id === "autoPercentUsed");
    const hasApi = windows.some((w) => w.id === "apiPercentUsed");
    const filtered = windows.filter((w) => !(hasAuto && hasApi && w.id === "totalPercentUsed"));
    if (!model || !hasAuto || !hasApi) {
      return { primary: filtered, other: [] };
    }
    const isAutoModel = /^(auto|default|grok|composer)/.test(model);
    const primaryId = isAutoModel ? "autoPercentUsed" : "apiPercentUsed";
    return {
      primary: filtered.filter((w) => w.id === primaryId),
      other: filtered.filter((w) => w.id !== primaryId),
    };
  }

  return { primary: windows, other: [] };
}

export type LedBlockState = "full" | "partial" | "empty";

export function computeLedBlockStates(
  remainingPercent: number,
  blockCount = 16,
): readonly LedBlockState[] {
  const clamped = Math.max(
    0,
    Math.min(100, Number.isFinite(remainingPercent) ? remainingPercent : 0),
  );
  const exact = (clamped / 100) * blockCount;
  const fullCount = Math.floor(exact);
  const remainder = exact - fullCount;
  const hasPartial = remainder >= 0.25 && fullCount < blockCount;

  return Array.from({ length: blockCount }, (_, index) => {
    if (index < fullCount) return "full";
    if (index === fullCount && hasPartial) return "partial";
    return "empty";
  });
}
