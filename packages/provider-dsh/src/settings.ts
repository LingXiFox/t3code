import {
  CustomModelSetting,
  makeBinaryPathSetting,
  makeProviderSettingsSchema,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

export const DshSettings = makeProviderSettingsSchema(
  {
    // Opt-in in Settings, matching other non-default CLI providers.
    enabled: Schema.Boolean.pipe(
      Schema.withDecodingDefault(Effect.succeed(false)),
      Schema.annotateKey({ providerSettingsForm: { hidden: true } }),
    ),
    binaryPath: makeBinaryPathSetting("dsh").pipe(
      Schema.annotateKey({
        title: "Binary path",
        description: "Path to the DeepSeek Harness (`dsh`) CLI binary.",
        providerSettingsForm: { placeholder: "dsh", clearWhenEmpty: "omit" },
      }),
    ),
    profile: Schema.optional(Schema.String).pipe(
      Schema.withDecodingDefault(Effect.succeed("acp")),
      Schema.annotateKey({
        title: "ACP profile",
        description: "Profile passed to `dsh --profile` when launching the ACP runtime.",
        providerSettingsForm: { placeholder: "acp", clearWhenEmpty: "omit" },
      }),
    ),
    customModels: Schema.Array(CustomModelSetting).pipe(
      Schema.withDecodingDefault(Effect.succeed([])),
      Schema.annotateKey({ providerSettingsForm: { hidden: true } }),
    ),
  },
  {
    order: ["binaryPath", "profile"],
  },
);
export type DshSettings = typeof DshSettings.Type;
