import type * as EffectAcpSchema from "effect-acp/compat";
import {
  type ModelCapabilities,
  ProviderDriverKind,
  type RuntimeMode,
  type ServerProviderModel,
} from "@t3tools/contracts";
import { createModelCapabilities } from "@t3tools/shared/model";
import type * as SecureRandom from "effect/crypto/SecureRandom";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type * as Scope from "effect/Scope";
import type * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import type * as EffectAcpErrors from "effect-acp/errors";

import * as AcpSessionRuntime from "@t3tools/provider-acp/server/AcpSessionRuntime";
import {
  acpProviderOptionDescriptors,
  isAcpThoughtLevelOption,
} from "@t3tools/provider-acp/server/sessionConfig";
import type { DshSettings } from "../settings.ts";

export const DSH_DRIVER_KIND = ProviderDriverKind.make("dsh");
export const DSH_DEFAULT_MODEL_SLUG = "default";
export const DSH_MODEL_CONFIG_ID = "model";
export const DSH_REASONING_EFFORT_CONFIG_ID = "reasoning_effort";
export const DSH_MIN_COMPATIBLE_VERSION = [0, 2, 0] as const;

export const DSH_SUPPORTED_RUNTIME_MODES = [
  "approval-required",
  "auto-accept-edits",
  "full-access",
] as const satisfies ReadonlyArray<RuntimeMode>;

export const DSH_EMPTY_CAPABILITIES: ModelCapabilities = createModelCapabilities({
  optionDescriptors: [],
});

export interface DshParsedVersion {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
  readonly raw: string;
}

/**
 * Parses `dsh --version` output such as `dsh 0.2.2-rc.5` or `0.2.2`.
 */
export function parseDshVersion(raw: string | null | undefined): DshParsedVersion | undefined {
  if (!raw) return undefined;
  const match = /\b(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?\b/.exec(raw.trim());
  if (!match) return undefined;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    raw: match[0],
  };
}

export function isDshVersionCompatible(version: string | null | undefined): boolean {
  const parsed = parseDshVersion(version);
  if (!parsed) return false;
  const tuple = [parsed.major, parsed.minor, parsed.patch] as const;
  for (let index = 0; index < 3; index++) {
    const diff = tuple[index]! - DSH_MIN_COMPATIBLE_VERSION[index]!;
    if (diff !== 0) return diff > 0;
  }
  return true;
}

type DshRuntimeSettings = Pick<DshSettings, "binaryPath" | "profile">;

export function buildDshAcpSpawnInput(
  settings: DshRuntimeSettings | null | undefined,
  cwd: string,
  environment?: NodeJS.ProcessEnv,
): AcpSessionRuntime.AcpSpawnInput {
  const profile = settings?.profile?.trim() || "acp";
  return {
    command: settings?.binaryPath || "dsh",
    args: ["--profile", profile],
    cwd,
    // Keep DSH's own home, provider, and plugin configuration untouched.
    ...(environment === undefined ? {} : { env: environment }),
  };
}

export function dshReasoningOption(
  configOptions: ReadonlyArray<EffectAcpSchema.SessionConfigOption> | null | undefined,
) {
  const option =
    configOptions?.find((candidate) => candidate.id === DSH_REASONING_EFFORT_CONFIG_ID) ??
    configOptions?.find(isAcpThoughtLevelOption);
  return option?.type === "select" ? option : undefined;
}

export function dshModelCapabilitiesFromConfigOptions(
  configOptions: ReadonlyArray<EffectAcpSchema.SessionConfigOption> | null | undefined,
): ModelCapabilities {
  const reasoning = dshReasoningOption(configOptions);
  if (!reasoning) return DSH_EMPTY_CAPABILITIES;
  const descriptors = acpProviderOptionDescriptors({
    configOptions: [reasoning],
    modeState: undefined,
  });
  return descriptors.length > 0
    ? createModelCapabilities({ optionDescriptors: descriptors })
    : DSH_EMPTY_CAPABILITIES;
}

interface FlattenedDshModelChoice {
  readonly value: string;
  readonly name: string;
  readonly groupName?: string | undefined;
}

function flattenDshModelEntries(
  option: Extract<EffectAcpSchema.SessionConfigOption, { readonly type: "select" }>,
): ReadonlyArray<FlattenedDshModelChoice> {
  const entries: Array<FlattenedDshModelChoice> = [];
  for (const candidate of option.options) {
    if ("value" in candidate) {
      entries.push({ value: candidate.value, name: candidate.name });
      continue;
    }
    const groupName = candidate.name.trim() || candidate.groupId.trim() || undefined;
    for (const child of candidate.options) {
      entries.push({
        value: child.value,
        name: child.name,
        ...(groupName ? { groupName } : {}),
      });
    }
  }
  return entries;
}

/**
 * Parses DSH `session/new` `configOptions`, preserving JSON `["provider","model"]` wire tuples
 * and disambiguating duplicate display names with their group label.
 */
export function parseDshModelsFromConfigOptions(
  configOptions: ReadonlyArray<EffectAcpSchema.SessionConfigOption> | null | undefined,
  perModelConfigOptions: ReadonlyMap<
    string,
    ReadonlyArray<EffectAcpSchema.SessionConfigOption>
  > = new Map(),
): ReadonlyArray<ServerProviderModel> {
  const modelOption = configOptions?.find(
    (option) => option.id === DSH_MODEL_CONFIG_ID || option.category === "model",
  );
  if (modelOption?.type !== "select") return [];
  const entries = flattenDshModelEntries(modelOption);
  const nameCounts = new Map<string, number>();
  for (const entry of entries) {
    const base = entry.name.trim() || entry.value;
    nameCounts.set(base, (nameCounts.get(base) ?? 0) + 1);
  }
  const seen = new Set<string>();
  const models: Array<ServerProviderModel> = [];
  for (const entry of entries) {
    if (!entry.value.trim() || seen.has(entry.value)) continue;
    seen.add(entry.value);
    const baseName = entry.name.trim() || entry.value;
    const isDuplicateName = (nameCounts.get(baseName) ?? 0) > 1;
    const displayName =
      isDuplicateName && entry.groupName ? `${baseName} (${entry.groupName})` : baseName;
    const observedConfigOptions =
      perModelConfigOptions.get(entry.value) ??
      (entry.value === modelOption.currentValue ? configOptions : undefined);
    models.push({
      slug: entry.value,
      name: displayName,
      isCustom: false,
      ...(entry.value === modelOption.currentValue
        ? { isDefault: true, aliases: [DSH_DEFAULT_MODEL_SLUG] }
        : {}),
      capabilities: observedConfigOptions
        ? dshModelCapabilitiesFromConfigOptions(observedConfigOptions)
        : DSH_EMPTY_CAPABILITIES,
    });
  }
  return models;
}

export interface DshAcpRuntimeInput extends Omit<
  AcpSessionRuntime.AcpSessionRuntimeOptions,
  "authMethodId" | "cancelBehavior" | "resumeMethod" | "spawn"
> {
  readonly settings: DshRuntimeSettings | null | undefined;
  readonly environment?: NodeJS.ProcessEnv;
}

export const makeDshAcpRuntime = Effect.fn("DshAcpSupport.makeDshAcpRuntime")(function* (
  input: DshAcpRuntimeInput,
): Effect.fn.Return<
  AcpSessionRuntime.AcpSessionRuntime["Service"],
  EffectAcpErrors.AcpError,
  ChildProcessSpawner.ChildProcessSpawner | SecureRandom.SecureRandom | Scope.Scope
> {
  const { settings, environment, ...runtimeOptions } = input;
  const context = yield* Layer.build(
    AcpSessionRuntime.layer({
      ...runtimeOptions,
      resumeMethod: "resume",
      cancelBehavior: "wait-for-prompt",
      spawn: buildDshAcpSpawnInput(settings, input.cwd, environment),
    }),
  );
  return yield* Effect.service(AcpSessionRuntime.AcpSessionRuntime).pipe(Effect.provide(context));
});
