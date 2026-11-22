import { resolveProviderProbeTimeoutMs } from "@t3tools/provider-core/server/snapshotProbe";
import { type ServerProviderAuth, type ServerProviderModel } from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import { resolveSpawnCommand } from "@t3tools/shared/shell";
import type * as SecureRandom from "effect/crypto/SecureRandom";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import { ChildProcess, type ChildProcessSpawner } from "effect/process";
import type * as EffectAcpSchema from "effect-acp/compat";

import {
  buildServerProvider,
  isCommandMissingCause,
  parseCliVersionResult,
  providerModelsFromSettings,
  providerProbeEnvironment,
  spawnAndCollect,
  type ProviderProbeResult,
  type ServerProviderDraft,
} from "@t3tools/provider-core/server/snapshotProbe";
import type { DshSettings } from "../settings.ts";
import {
  DSH_DRIVER_KIND,
  DSH_EMPTY_CAPABILITIES,
  DSH_MIN_COMPATIBLE_VERSION,
  DSH_MODEL_CONFIG_ID,
  DSH_SUPPORTED_RUNTIME_MODES,
  isDshVersionCompatible,
  makeDshAcpRuntime,
  parseDshModelsFromConfigOptions,
  parseDshVersion,
} from "./acpSupport.ts";

const DSH_PRESENTATION = {
  displayName: "DeepSeek Harness",
  showInteractionModeToggle: false,
  supportedRuntimeModes: DSH_SUPPORTED_RUNTIME_MODES,
} as const;

const VERSION_PROBE_TIMEOUT_MS = 10_000;
const ACP_PROBE_TIMEOUT_MS = 20_000;
const MAX_PROBED_MODELS = 24;

function dshModels(
  settings: DshSettings,
  listed: ReadonlyArray<ServerProviderModel> = [],
): ReadonlyArray<ServerProviderModel> {
  return providerModelsFromSettings(listed, settings.customModels, DSH_EMPTY_CAPABILITIES);
}

function snapshot(
  settings: DshSettings,
  checkedAt: string,
  probe: ProviderProbeResult,
  listed?: ReadonlyArray<ServerProviderModel>,
): ServerProviderDraft {
  return buildServerProvider({
    driver: DSH_DRIVER_KIND,
    presentation: DSH_PRESENTATION,
    enabled: settings.enabled,
    checkedAt,
    models: dshModels(settings, listed),
    slashCommands: [],
    probe,
  });
}

export const buildInitialDshProviderSnapshot = Effect.fn(
  "DshProvider.buildInitialDshProviderSnapshot",
)(function* (settings: DshSettings): Effect.fn.Return<ServerProviderDraft> {
  const now = yield* DateTime.now;
  return snapshot(settings, DateTime.formatIso(now), {
    installed: settings.enabled,
    version: null,
    status: "warning",
    auth: { status: "unknown" },
    message: settings.enabled
      ? "Checking DeepSeek Harness (`dsh`) availability..."
      : "DeepSeek Harness is disabled in LingXi T3 settings.",
  });
});

const runDshCli = Effect.fn("DshProvider.runDshCli")(function* (
  settings: DshSettings,
  args: ReadonlyArray<string>,
  environment: NodeJS.ProcessEnv,
) {
  const command = settings.binaryPath || "dsh";
  const spawnCommand = yield* resolveSpawnCommand(command, args, { env: environment });
  return yield* spawnAndCollect(
    command,
    ChildProcess.make(spawnCommand.command, spawnCommand.args, {
      env: environment,
      shell: spawnCommand.shell,
    }),
  );
});

const probeDshAcpCapabilities = Effect.fn("DshProvider.probeDshAcpCapabilities")(function* (
  settings: DshSettings,
  environment: NodeJS.ProcessEnv,
) {
  const runtime = yield* makeDshAcpRuntime({
    settings,
    environment,
    cwd: yield* HostProcess.WorkingDirectory,
    clientInfo: { name: "lingxi-t3-provider-probe", version: "0.0.0" },
  });
  const started = yield* runtime.start();
  const initialConfigOptions = started.sessionSetupResult.configOptions ?? [];
  const perModelConfigOptions = new Map<
    string,
    ReadonlyArray<EffectAcpSchema.SessionConfigOption>
  >();
  const modelOption = initialConfigOptions.find(
    (option) => option.id === DSH_MODEL_CONFIG_ID || option.category === "model",
  );
  if (modelOption?.type === "select") {
    perModelConfigOptions.set(modelOption.currentValue, initialConfigOptions);
    const values = modelOption.options
      .flatMap((entry) => ("value" in entry ? [entry.value] : entry.options.map((c) => c.value)))
      .filter((value) => value.trim().length > 0 && value !== modelOption.currentValue)
      .slice(0, MAX_PROBED_MODELS);
    for (const modelValue of values) {
      const switched = yield* runtime
        .setConfigOption(modelOption.id, modelValue)
        .pipe(Effect.andThen(runtime.getConfigOptions), Effect.option);
      if (Option.isSome(switched)) {
        perModelConfigOptions.set(modelValue, switched.value);
      }
    }
  }
  const models = parseDshModelsFromConfigOptions(initialConfigOptions, perModelConfigOptions);
  if (started.initializeResult.agentCapabilities?.sessionCapabilities?.close !== undefined) {
    yield* runtime.request("session/close", { sessionId: started.sessionId }).pipe(Effect.ignore);
  }
  return {
    models,
    agentInfo: started.initializeResult.agentInfo,
  };
}, Effect.scoped);

export const checkDshProviderStatus = Effect.fn("checkDshProviderStatus")(function* (
  settings: DshSettings,
  environment: NodeJS.ProcessEnv,
): Effect.fn.Return<
  ServerProviderDraft,
  never,
  ChildProcessSpawner.ChildProcessSpawner | SecureRandom.SecureRandom
> {
  const checkedAt = DateTime.formatIso(yield* DateTime.now);
  if (!settings.enabled) {
    return snapshot(settings, checkedAt, {
      installed: false,
      version: null,
      status: "warning",
      auth: { status: "unknown" },
      message: "DeepSeek Harness is disabled in LingXi T3 settings.",
    });
  }

  const probeEnvironment = providerProbeEnvironment(environment);
  const versionResult = yield* runDshCli(settings, ["--version"], probeEnvironment).pipe(
    Effect.timeoutOption(
      resolveProviderProbeTimeoutMs("dsh", VERSION_PROBE_TIMEOUT_MS, environment),
    ),
    Effect.result,
  );
  if (Result.isFailure(versionResult) || Option.isNone(versionResult.success)) {
    const missing = Result.isFailure(versionResult) && isCommandMissingCause(versionResult.failure);
    return snapshot(settings, checkedAt, {
      installed: !missing,
      version: null,
      status: "error",
      auth: { status: "unknown" },
      message: missing
        ? "DeepSeek Harness (`dsh`) is not installed or not on PATH."
        : "Failed to run `dsh --version`.",
    });
  }

  const versionOutput = versionResult.success.value;
  const rawVersion = parseCliVersionResult(versionOutput);
  const parsedVersion = parseDshVersion(rawVersion ?? versionOutput.stdout);
  const version = parsedVersion?.raw ?? rawVersion;
  if (versionOutput.code !== 0) {
    return snapshot(settings, checkedAt, {
      installed: true,
      version,
      status: "error",
      auth: { status: "unknown" },
      message: "DeepSeek Harness (`dsh`) is installed but failed to run.",
    });
  }

  if (version !== null && !isDshVersionCompatible(version)) {
    return snapshot(settings, checkedAt, {
      installed: true,
      version,
      status: "error",
      auth: { status: "unknown" },
      message: `DeepSeek Harness ${version} is older than the minimum supported version ${DSH_MIN_COMPATIBLE_VERSION.join(".")}.`,
    });
  }

  const acpProbe = yield* probeDshAcpCapabilities(settings, probeEnvironment).pipe(
    Effect.timeoutOption(resolveProviderProbeTimeoutMs("dsh", ACP_PROBE_TIMEOUT_MS, environment)),
    Effect.result,
  );
  if (Result.isFailure(acpProbe) || Option.isNone(acpProbe.success)) {
    const profile = settings.profile?.trim() || "acp";
    return snapshot(settings, checkedAt, {
      installed: true,
      version,
      status: "error",
      auth: { status: "unknown" },
      message: `Failed to start \`dsh --profile ${profile}\` ACP session. Verify your DSH configuration and credentials.`,
    });
  }

  const { models } = acpProbe.success.value;
  if (models.length === 0) {
    const auth: ServerProviderAuth = { status: "unauthenticated" };
    return snapshot(settings, checkedAt, {
      installed: true,
      version,
      status: "warning",
      auth,
      message:
        "DeepSeek Harness ACP started, but no models are configured. Configure a provider in `dsh` first.",
    });
  }

  return snapshot(
    settings,
    checkedAt,
    {
      installed: true,
      version,
      status: "ready",
      auth: { status: "authenticated", label: "DSH profile config" },
    },
    models,
  );
});
