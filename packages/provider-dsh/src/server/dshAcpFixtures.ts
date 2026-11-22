import type * as EffectAcpSchema from "effect-acp/compat";

/**
 * Sanitized protocol fixtures captured from live `dsh --profile acp` (0.2.2-rc.5).
 */
export const DSH_0_2_2_INITIALIZE_RESPONSE: EffectAcpSchema.InitializeResponse = {
  protocolVersion: 1,
  agentInfo: {
    name: "deepseek-harness-acp",
    version: "0.0.1",
  },
  agentCapabilities: {
    mcpCapabilities: {
      http: true,
    },
    promptCapabilities: {
      image: true,
      audio: false,
      embeddedContext: false,
    },
    sessionCapabilities: {
      close: {},
      list: {},
      resume: {},
    },
  },
  authMethods: [],
};

const DSH_FLASH_REASONING_OPTION: EffectAcpSchema.SessionConfigOption = {
  id: "reasoning_effort",
  name: "Reasoning effort",
  category: "thought_level",
  type: "select",
  currentValue: "",
  options: [
    { value: "", name: "Provider default" },
    { value: "low", name: "Low" },
    { value: "high", name: "High" },
    { value: "max", name: "Max" },
  ],
};

const DSH_PRO_REASONING_OPTION: EffectAcpSchema.SessionConfigOption = {
  id: "reasoning_effort",
  name: "Reasoning effort",
  category: "thought_level",
  type: "select",
  currentValue: "high",
  options: [
    { value: "off", name: "Off" },
    { value: "low", name: "Low" },
    { value: "high", name: "High" },
    { value: "max", name: "Max" },
  ],
};

const DSH_0_2_2_MODEL_OPTION = {
  id: "model",
  name: "Model",
  category: "model",
  type: "select",
  currentValue: '["greeshare","deepseek-v4.1-flash"]',
  options: [
    {
      groupId: "deepseek-official",
      name: "DeepSeek",
      options: [
        { value: '["deepseek-official","deepseek-flash"]', name: "DeepSeek-V4.1-Flash" },
        { value: '["deepseek-official","deepseek-v4-pro"]', name: "DeepSeek-V4-Pro" },
      ],
    },
    {
      groupId: "deepseek-account",
      name: "DeepSeek Account",
      options: [
        { value: '["deepseek-account","deepseek-flash"]', name: "DeepSeek-V4.1-Flash" },
        { value: '["deepseek-account","deepseek-v4-pro"]', name: "DeepSeek-V4-Pro" },
      ],
    },
    {
      groupId: "greeshare",
      name: "FreeShare",
      options: [
        {
          value: '["greeshare","deepseek-v4.1-flash"]',
          name: "[FreeShare] DeepSeek V4.1 Flash",
        },
      ],
    },
  ],
} satisfies EffectAcpSchema.SessionConfigOption;

export const DSH_0_2_2_SESSION_NEW_CONFIG_OPTIONS: ReadonlyArray<EffectAcpSchema.SessionConfigOption> =
  [DSH_0_2_2_MODEL_OPTION, DSH_FLASH_REASONING_OPTION];

export const DSH_0_2_2_PRO_CONFIG_OPTIONS: ReadonlyArray<EffectAcpSchema.SessionConfigOption> = [
  {
    ...DSH_0_2_2_MODEL_OPTION,
    currentValue: '["deepseek-account","deepseek-v4-pro"]',
  },
  DSH_PRO_REASONING_OPTION,
];
