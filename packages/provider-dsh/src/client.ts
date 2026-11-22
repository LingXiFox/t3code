import { ProviderDriverKind } from "@t3tools/contracts";
import { defineProviderClient } from "@t3tools/provider-core/client";

import { DshSettings } from "./settings.ts";

export const dshClient = defineProviderClient({
  driverKind: ProviderDriverKind.make("dsh"),
  label: "DeepSeek Harness",
  featured: false,
  badgeLabel: "ACP",
  modelFamilies: ["DeepSeek-", "DeepSeek "],
  settingsSchema: DshSettings,
  icon: {
    viewBox: "0 0 24 24",
    fill: { light: "#4D6BFE", dark: "#6B8AFF" },
    paths: [
      // Original geometric whale & crest emblem for DeepSeek Harness.
      {
        d: "M19.8 8.6c-.8-.1-1.6.3-2.2.9-.7-.9-1.9-1.5-3.4-1.5-2.1 0-3.7 1.1-4.8 2.4-.7-.5-1.6-.8-2.6-.7-2 .2-3.8 1.8-4.4 4.1-.2.7-.1 1.4.3 2 .9 1.6 3.1 2.7 6.5 2.7 4.7 0 8.2-2.2 9.4-5.7.5-.4 1-.9 1.4-1.6.4-.8.4-1.7.1-2.3-.1-.2-.2-.3-.3-.3ZM8.9 14.2c-.6 0-1.1-.5-1.1-1.1s.5-1.1 1.1-1.1 1.1.5 1.1 1.1-.5 1.1-1.1 1.1Zm4.9-8.1c.9 0 1.7-.7 1.9-1.6-.6.2-1.3.1-1.9-.3-.5.4-.7 1.1-.4 1.6.1.2.3.3.4.3Z",
      },
    ],
  },
});
