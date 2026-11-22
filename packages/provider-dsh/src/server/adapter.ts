import * as HostProcess from "@t3tools/shared/HostProcess";
import { resolveSelfInvocation, type SelfInvocation } from "@t3tools/shared/nodeRuntime";
import {
  type ModelSelection,
  type OrchestrationV2ProviderCapabilities,
  ProviderDriverKind,
} from "@t3tools/contracts";
import { getModelSelectionStringOptionValue } from "@t3tools/shared/model";
import type * as SecureRandom from "effect/crypto/SecureRandom";
import * as Effect from "effect/Effect";
import type * as FileSystem from "effect/FileSystem";
import type * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";
import type * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import type * as EffectAcpSchema from "effect-acp/compat";
import * as EffectAcpErrors from "effect-acp/errors";

import type * as AcpSessionRuntime from "@t3tools/provider-acp/server/AcpSessionRuntime";
import {
  AcpProviderCapabilitiesV2,
  makeAcpAdapterV2,
  type AcpAdapterV2Flavor,
  type AcpAdapterV2RuntimeInput,
} from "@t3tools/provider-acp/server/adapter";
import { makeAcpNativeLoggerFactory } from "@t3tools/provider-acp/server/nativeLogging";
import {
  ACP_EMPTY_OPTION_VALUE,
  flattenSelectChoices,
} from "@t3tools/provider-acp/server/sessionConfig";
import {
  ProviderAdapterDriverCreateError,
  type ProviderAdapterDriver,
  type ProviderAdapterDriverCreateInput,
} from "@t3tools/provider-core/server/adapterDriver";
import { makeProviderFailure } from "@t3tools/provider-core/server/failure";
import type * as IdAllocator from "@t3tools/provider-core/server/IdAllocator";
import { mergeProviderInstanceEnvironment } from "@t3tools/provider-core/server/instanceEnvironment";
import type * as McpProviderSessions from "@t3tools/provider-core/server/McpProviderSessions";
import * as ProviderEventLoggers from "@t3tools/provider-core/server/ProviderEventLoggers";
import type * as ProviderHost from "@t3tools/provider-core/server/ProviderHost";
import { DshSettings } from "../settings.ts";
import {
  DSH_DEFAULT_MODEL_SLUG,
  DSH_MODEL_CONFIG_ID,
  DSH_REASONING_EFFORT_CONFIG_ID,
  dshReasoningOption,
  makeDshAcpRuntime,
} from "./acpSupport.ts";

const DSH_PROVIDER = ProviderDriverKind.make("dsh");
const DEFAULT_DSH_SETTINGS = Schema.decodeSync(DshSettings)({});
const isAcpRequestError = Schema.is(EffectAcpErrors.AcpRequestError);

/**
 * Verified against `dsh 0.2.2-rc.5`: supports in-session model/config switches,
 * HTTP MCP, image prompts, session list/resume/close. Does not advertise fork or active steering.
 */
const DshProviderCapabilitiesV2 = {
  ...AcpProviderCapabilitiesV2,
  sessions: {
    ...AcpProviderCapabilitiesV2.sessions,
    supportsModelSwitchInSession: true,
  },
  tools: {
    ...AcpProviderCapabilitiesV2.tools,
    supportsMcpTools: true,
  },
} satisfies OrchestrationV2ProviderCapabilities;

export interface DshAdapterV2Options {
  readonly instanceId: Parameters<typeof makeAcpAdapterV2>[0]["instanceId"];
  readonly settings: DshSettings;
  readonly environment: NodeJS.ProcessEnv;
  readonly selfInvocation: SelfInvocation;
  readonly nativeLogging?: Parameters<typeof makeAcpAdapterV2>[0]["nativeLogging"];
  readonly makeRuntime?: (
    input: AcpAdapterV2RuntimeInput,
  ) => Effect.Effect<
    AcpSessionRuntime.AcpSessionRuntime["Service"],
    EffectAcpErrors.AcpError,
    ChildProcessSpawner.ChildProcessSpawner | SecureRandom.SecureRandom | Scope.Scope
  >;
  readonly assertComplete?: Effect.Effect<void, EffectAcpErrors.AcpError>;
  readonly testHooks?: Parameters<typeof makeAcpAdapterV2>[0]["testHooks"];
}

function findDshModelOption(configOptions: ReadonlyArray<EffectAcpSchema.SessionConfigOption>) {
  return configOptions.find(
    (option) => option.id === DSH_MODEL_CONFIG_ID || option.category === "model",
  );
}

const applyDshModel = Effect.fn("DshAdapterV2.applyDshModel")(function* (
  runtime: AcpSessionRuntime.AcpSessionRuntime["Service"],
  modelSelection: ModelSelection,
) {
  const modelOption = findDshModelOption(yield* runtime.getConfigOptions);
  if (modelOption?.type !== "select") return undefined;
  const current = modelOption.currentValue;
  const selected = modelSelection.model.trim();
  if (selected.length === 0 || selected === DSH_DEFAULT_MODEL_SLUG || selected === current) {
    return current;
  }
  yield* runtime.setConfigOption(modelOption.id, selected);
  return selected;
});

const applyDshReasoningEffort = Effect.fn("DshAdapterV2.applyDshReasoningEffort")(function* (
  runtime: AcpSessionRuntime.AcpSessionRuntime["Service"],
  modelSelection: ModelSelection,
) {
  const requestedRaw =
    getModelSelectionStringOptionValue(modelSelection, DSH_REASONING_EFFORT_CONFIG_ID) ??
    getModelSelectionStringOptionValue(modelSelection, "thought_level") ??
    getModelSelectionStringOptionValue(modelSelection, "reasoningEffort");
  if (requestedRaw === undefined) return;

  const wireValue = requestedRaw === ACP_EMPTY_OPTION_VALUE ? "" : requestedRaw;
  // Read authoritative post-model-switch options because DSH changes reasoning choices per model.
  const reasoning = dshReasoningOption(yield* runtime.getConfigOptions);
  if (!reasoning || reasoning.currentValue === wireValue) return;
  const allowed = flattenSelectChoices(reasoning.options).map((choice) => choice.value);
  if (!allowed.includes(wireValue)) {
    yield* Effect.logWarning("Skipping DSH reasoning_effort unsupported by the active model", {
      requested: wireValue,
      allowed,
    });
    return;
  }

  yield* runtime.setConfigOption(reasoning.id, wireValue).pipe(
    Effect.catchTags({
      AcpRequestError: (error) =>
        Effect.logWarning("DSH rejected reasoning_effort update", {
          id: reasoning.id,
          value: wireValue,
          code: error.code,
          errorMessage: error.errorMessage,
        }),
    }),
  );
});

export const applyDshModelSelection: NonNullable<AcpAdapterV2Flavor["applyModelSelection"]> = ({
  runtime,
  modelSelection,
}) =>
  applyDshModel(runtime, modelSelection).pipe(
    Effect.tap(() => applyDshReasoningEffort(runtime, modelSelection)),
  );

function dshPromptFailure(cause: unknown) {
  return makeProviderFailure({
    cause,
    ...(isAcpRequestError(cause) ? { message: cause.errorMessage, code: String(cause.code) } : {}),
    class: "provider_error",
  });
}

function makeDshAcpAdapterFlavor(options: DshAdapterV2Options): AcpAdapterV2Flavor {
  const makeRuntime =
    options.makeRuntime ??
    ((input: AcpAdapterV2RuntimeInput) => {
      const { runtimePolicy: _runtimePolicy, processEnvironment, ...runtimeInput } = input;
      return makeDshAcpRuntime({
        ...runtimeInput,
        settings: options.settings,
        environment: { ...options.environment, ...processEnvironment },
      });
    });

  return {
    driver: DSH_PROVIDER,
    runtimeHarness: "DeepSeek Harness",
    capabilities: DshProviderCapabilitiesV2,
    mcpOverHttp: true,
    makeRuntime,
    promptFailure: dshPromptFailure,
    applyModelSelection: applyDshModelSelection,
    ownedModelOptionIds: [DSH_REASONING_EFFORT_CONFIG_ID, "thought_level", "reasoningEffort"],
    ...(options.assertComplete === undefined ? {} : { assertComplete: options.assertComplete }),
  };
}

const makeDshAdapterV2 = Effect.fn("makeDshAdapterV2")(function* (options: DshAdapterV2Options) {
  return yield* makeAcpAdapterV2({
    instanceId: options.instanceId,
    flavor: makeDshAcpAdapterFlavor(options),
    selfInvocation: options.selfInvocation,
    ...(options.nativeLogging === undefined ? {} : { nativeLogging: options.nativeLogging }),
    ...(options.testHooks === undefined ? {} : { testHooks: options.testHooks }),
  });
});

export type DshAdapterV2DriverEnv =
  | ChildProcessSpawner.ChildProcessSpawner
  | SecureRandom.SecureRandom
  | FileSystem.FileSystem
  | IdAllocator.IdAllocatorV2
  | Path.Path
  | McpProviderSessions.McpProviderSessions
  | ProviderEventLoggers.ProviderEventLoggers
  | ProviderHost.ProviderHost;

export const makeDshAdapterV2Driver = (): ProviderAdapterDriver<
  DshSettings,
  DshAdapterV2DriverEnv
> => ({
  driverKind: DSH_PROVIDER,
  configSchema: DshSettings,
  defaultConfig: (): DshSettings => DEFAULT_DSH_SETTINGS,
  create: Effect.fn("DshAdapterV2Driver.create")(
    function* (input: ProviderAdapterDriverCreateInput<DshSettings>) {
      const hostEnvironment = yield* HostProcess.Environment;
      const selfInvocation = yield* resolveSelfInvocation();
      const providerEventLoggers = yield* ProviderEventLoggers.ProviderEventLoggers;
      const makeNativeLogger = yield* makeAcpNativeLoggerFactory();
      return yield* makeDshAdapterV2({
        instanceId: input.instanceId,
        settings: { ...input.config, enabled: input.enabled },
        environment: yield* mergeProviderInstanceEnvironment(input.environment, hostEnvironment),
        selfInvocation,
        nativeLogging: (threadId) =>
          makeNativeLogger({
            nativeEventLogger: providerEventLoggers.native,
            provider: DSH_PROVIDER,
            threadId,
          }),
      });
    },
    (effect, input) =>
      effect.pipe(
        Effect.mapError(
          (cause) =>
            new ProviderAdapterDriverCreateError({
              driver: DSH_PROVIDER,
              instanceId: input.instanceId,
              detail: "Failed to create DeepSeek Harness ACP adapter.",
              cause,
            }),
        ),
      ),
  ),
});
