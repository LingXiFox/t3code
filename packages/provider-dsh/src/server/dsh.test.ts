import { describe, expect, it } from "@effect/vitest";
import { ACP_EMPTY_OPTION_VALUE } from "@t3tools/provider-acp/server/sessionConfig";
import { ProviderInstanceId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as EffectAcpErrors from "effect-acp/errors";
import type * as AcpSessionRuntime from "@t3tools/provider-acp/server/AcpSessionRuntime";

import {
  buildDshAcpSpawnInput,
  dshModelCapabilitiesFromConfigOptions,
  isDshVersionCompatible,
  parseDshModelsFromConfigOptions,
  parseDshVersion,
} from "./acpSupport.ts";
import { applyDshModelSelection } from "./adapter.ts";
import {
  DSH_0_2_2_INITIALIZE_RESPONSE,
  DSH_0_2_2_PRO_CONFIG_OPTIONS,
  DSH_0_2_2_SESSION_NEW_CONFIG_OPTIONS,
} from "./dshAcpFixtures.ts";

describe("DeepSeek Harness ACP support", () => {
  it("parses prerelease versions and enforces minimum compatible version 0.2.0", () => {
    expect(parseDshVersion("dsh 0.2.2-rc.5")).toEqual({
      major: 0,
      minor: 2,
      patch: 2,
      raw: "0.2.2-rc.5",
    });
    expect(isDshVersionCompatible("0.2.2-rc.5")).toBe(true);
    expect(isDshVersionCompatible("0.2.0")).toBe(true);
    expect(isDshVersionCompatible("0.1.9")).toBe(false);
    expect(isDshVersionCompatible(null)).toBe(false);
  });

  it("spawns `dsh --profile acp` without mutating user DSH environment", () => {
    const spawn = buildDshAcpSpawnInput(
      { binaryPath: "/usr/local/bin/dsh", profile: "acp" },
      "/tmp/work",
      { DSH_HOME: "/Users/example/.dsh" },
    );
    expect(spawn).toEqual({
      command: "/usr/local/bin/dsh",
      args: ["--profile", "acp"],
      cwd: "/tmp/work",
      env: { DSH_HOME: "/Users/example/.dsh" },
    });
  });

  it("parses grouped tuple models, disambiguates duplicate names, and isolates per-model reasoning_effort", () => {
    const perModel = new Map([
      ['["greeshare","deepseek-v4.1-flash"]', DSH_0_2_2_SESSION_NEW_CONFIG_OPTIONS],
      ['["deepseek-account","deepseek-v4-pro"]', DSH_0_2_2_PRO_CONFIG_OPTIONS],
    ]);
    const models = parseDshModelsFromConfigOptions(DSH_0_2_2_SESSION_NEW_CONFIG_OPTIONS, perModel);

    expect(models.map((m) => ({ slug: m.slug, name: m.name, isDefault: m.isDefault }))).toEqual([
      {
        slug: '["deepseek-official","deepseek-flash"]',
        name: "DeepSeek-V4.1-Flash (DeepSeek)",
        isDefault: undefined,
      },
      {
        slug: '["deepseek-official","deepseek-v4-pro"]',
        name: "DeepSeek-V4-Pro (DeepSeek)",
        isDefault: undefined,
      },
      {
        slug: '["deepseek-account","deepseek-flash"]',
        name: "DeepSeek-V4.1-Flash (DeepSeek Account)",
        isDefault: undefined,
      },
      {
        slug: '["deepseek-account","deepseek-v4-pro"]',
        name: "DeepSeek-V4-Pro (DeepSeek Account)",
        isDefault: undefined,
      },
      {
        slug: '["greeshare","deepseek-v4.1-flash"]',
        name: "[FreeShare] DeepSeek V4.1 Flash",
        isDefault: true,
      },
    ]);

    const flash = models.find((m) => m.slug === '["greeshare","deepseek-v4.1-flash"]');
    const flashDescriptor = flash?.capabilities?.optionDescriptors?.[0];
    expect(flashDescriptor?.type).toBe("select");
    if (flashDescriptor?.type === "select") {
      expect(flashDescriptor.id).toBe("reasoning_effort");
      expect(flashDescriptor.currentValue).toBe(ACP_EMPTY_OPTION_VALUE);
      expect(flashDescriptor.options.map((o) => o.id)).toEqual([
        ACP_EMPTY_OPTION_VALUE,
        "low",
        "high",
        "max",
      ]);
    }

    const pro = models.find((m) => m.slug === '["deepseek-account","deepseek-v4-pro"]');
    const proDescriptor = pro?.capabilities?.optionDescriptors?.[0];
    expect(proDescriptor?.type).toBe("select");
    if (proDescriptor?.type === "select") {
      expect(proDescriptor.id).toBe("reasoning_effort");
      expect(proDescriptor.currentValue).toBe("high");
      // Must NOT offer empty "" option because `deepseek-v4-pro` rejects it (-32602).
      expect(proDescriptor.options.map((o) => o.id)).toEqual(["off", "low", "high", "max"]);
    }

    expect(dshModelCapabilitiesFromConfigOptions([]).optionDescriptors).toEqual([]);
  });

  it.effect(
    "applies model switch before reasoning_effort, skips invalid stale empty effort, and handles -32602 rejection",
    () =>
      Effect.gen(function* () {
        const calls: Array<{ id: string; value: string | boolean }> = [];
        let currentConfig = [...DSH_0_2_2_SESSION_NEW_CONFIG_OPTIONS];
        let rejectReasoning = false;
        const runtime = {
          getConfigOptions: Effect.sync(() => currentConfig),
          setConfigOption: (id: string, value: string | boolean) =>
            Effect.suspend(() => {
              calls.push({ id, value });
              if (id === "model" && value === '["deepseek-account","deepseek-v4-pro"]') {
                currentConfig = [...DSH_0_2_2_PRO_CONFIG_OPTIONS];
                return Effect.succeed({ configOptions: currentConfig });
              }
              if (id === "reasoning_effort" && rejectReasoning) {
                return Effect.fail(
                  EffectAcpErrors.AcpRequestError.invalidParams(
                    "unknown reasoning effort for deepseek-account/deepseek-v4-pro",
                  ),
                );
              }
              return Effect.succeed({ configOptions: currentConfig });
            }),
        } as unknown as AcpSessionRuntime.AcpSessionRuntime["Service"];

        const startResult = {
          sessionId: "session-dsh-1",
          initializeResult: DSH_0_2_2_INITIALIZE_RESPONSE,
          sessionSetupResult: {
            sessionId: "session-dsh-1",
            configOptions: DSH_0_2_2_SESSION_NEW_CONFIG_OPTIONS,
          },
          modelConfigId: "model",
        } as AcpSessionRuntime.AcpSessionRuntimeStartResult;

        const instanceId = ProviderInstanceId.make("dsh");

        // Switching from FreeShare Flash (with stale "") to Pro must skip "" so -32602 is never triggered.
        yield* applyDshModelSelection({
          runtime,
          startResult,
          modelSelection: {
            instanceId,
            model: '["deepseek-account","deepseek-v4-pro"]',
            options: [{ id: "reasoning_effort", value: ACP_EMPTY_OPTION_VALUE }],
          },
        });
        expect(calls).toEqual([{ id: "model", value: '["deepseek-account","deepseek-v4-pro"]' }]);

        // Valid reasoning_effort ("max") is applied cleanly.
        calls.length = 0;
        yield* applyDshModelSelection({
          runtime,
          startResult,
          modelSelection: {
            instanceId,
            model: '["deepseek-account","deepseek-v4-pro"]',
            options: [{ id: "reasoning_effort", value: "max" }],
          },
        });
        expect(calls).toEqual([{ id: "reasoning_effort", value: "max" }]);

        // Agent -32602 rejection on reasoning_effort is caught gracefully without failing the turn.
        calls.length = 0;
        rejectReasoning = true;
        const applied = yield* applyDshModelSelection({
          runtime,
          startResult,
          modelSelection: {
            instanceId,
            model: '["deepseek-account","deepseek-v4-pro"]',
            options: [{ id: "reasoning_effort", value: "low" }],
          },
        });
        expect(applied).toBe('["deepseek-account","deepseek-v4-pro"]');
      }),
  );
});
