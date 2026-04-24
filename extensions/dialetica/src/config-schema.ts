import { buildChannelConfigSchema } from "openclaw/plugin-sdk/channel-config-schema";
import { z } from "openclaw/plugin-sdk/zod";

export const DialeticaAccountConfigSchema = z
  .object({
    name: z.string().optional(),
    enabled: z.boolean().optional(),
    baseUrl: z.string().url().optional(),
    apiToken: z.string().optional(),
    botUserId: z.string().optional(),
    botDisplayName: z.string().optional(),
    allowFrom: z.array(z.union([z.string(), z.number()])).optional(),
    defaultTo: z.string().optional(),
  })
  .strict();

const DialeticaConfigSchema = DialeticaAccountConfigSchema.extend({
  accounts: z.record(z.string(), DialeticaAccountConfigSchema.partial()).optional(),
  defaultAccount: z.string().optional(),
}).strict();

export const dialeticaPluginConfigSchema = buildChannelConfigSchema(DialeticaConfigSchema);
