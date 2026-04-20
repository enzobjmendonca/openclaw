import {
  buildChannelOutboundSessionRoute,
  createChatChannelPlugin,
} from "openclaw/plugin-sdk/channel-core";
import {
  DEFAULT_ACCOUNT_ID,
  listDialeticaAccountIds,
  resolveDefaultDialeticaAccountId,
  resolveDialeticaAccount,
} from "./accounts.js";
import { dialeticaPluginConfigSchema } from "./config-schema.js";
import { startDialeticaGatewayAccount } from "./gateway.js";
import { sendDialeticaText } from "./outbound.js";
import {
  buildDialeticaTarget,
  normalizeDialeticaTarget,
  parseDialeticaTarget,
} from "./protocol.js";
import type { ChannelPlugin } from "./runtime-api.js";
import type { CoreConfig, ResolvedDialeticaAccount } from "./types.js";

const CHANNEL_ID = "dialetica" as const;

const meta = {
  id: CHANNEL_ID,
  label: "Dialetica",
  selectionLabel: "Dialetica (Internal)",
  docsPath: "/channels/dialetica",
  docsLabel: "dialetica",
  blurb: "Internal room-based transport for Dialetica-managed OpenClaw teams.",
  order: 998,
  detailLabel: "Dialetica",
  systemImage: "app-window",
  markdownCapable: true,
};

export const dialeticaPlugin: ChannelPlugin<ResolvedDialeticaAccount> = createChatChannelPlugin({
  base: {
    id: CHANNEL_ID,
    meta,
    capabilities: {
      chatTypes: ["group"],
      blockStreaming: true,
    },
    reload: { configPrefixes: ["channels.dialetica"] },
    configSchema: dialeticaPluginConfigSchema,
    setup: {
      applyAccountConfig: ({ cfg, accountId, input }) => {
        const next = { ...(cfg as CoreConfig) };
        const channels = { ...next.channels };
        const base = { ...channels.dialetica };
        const accounts = { ...base.accounts };
        accounts[accountId] = {
          ...accounts[accountId],
          ...input,
        };
        channels.dialetica = {
          ...base,
          enabled: true,
          accounts,
        };
        next.channels = channels;
        return next;
      },
    },
    config: {
      listAccountIds: (cfg) => listDialeticaAccountIds(cfg as CoreConfig),
      resolveAccount: (cfg, accountId) =>
        resolveDialeticaAccount({ cfg: cfg as CoreConfig, accountId }),
      defaultAccountId: (cfg) => resolveDefaultDialeticaAccountId(cfg as CoreConfig),
      isConfigured: (account) => account.configured,
      resolveAllowFrom: ({ cfg, accountId }) =>
        resolveDialeticaAccount({ cfg: cfg as CoreConfig, accountId }).config.allowFrom,
      resolveDefaultTo: ({ cfg, accountId }) =>
        resolveDialeticaAccount({ cfg: cfg as CoreConfig, accountId }).config.defaultTo,
    },
    groups: {
      resolveRequireMention: () => true,
    },
    messaging: {
      normalizeTarget: normalizeDialeticaTarget,
      parseExplicitTarget: ({ raw }) => {
        const parsed = parseDialeticaTarget(raw);
        return {
          to: buildDialeticaTarget(parsed),
          chatType: "group",
        };
      },
      inferTargetChatType: () => "group",
      targetResolver: {
        looksLikeId: (raw) => raw.trim().length > 0,
        hint: "<roomId>",
      },
      resolveOutboundSessionRoute: ({ cfg, agentId, accountId, target }) => {
        const parsed = parseDialeticaTarget(target);
        return buildChannelOutboundSessionRoute({
          cfg,
          agentId,
          channel: CHANNEL_ID,
          accountId,
          peer: {
            kind: "group",
            id: parsed.roomId,
          },
          chatType: "group",
          from: `dialetica:${accountId ?? DEFAULT_ACCOUNT_ID}`,
          to: parsed.roomId,
        });
      },
    },
    gateway: {
      startAccount: async (ctx) => {
        await startDialeticaGatewayAccount(CHANNEL_ID, meta.label, ctx);
      },
    },
  },
  outbound: {
    base: {
      deliveryMode: "direct",
    },
    attachedResults: {
      channel: CHANNEL_ID,
      sendText: async ({ cfg, to, text, accountId, replyToId }) =>
        await sendDialeticaText({
          cfg: cfg as CoreConfig,
          accountId,
          to,
          text,
          replyToId,
        }),
    },
  },
});
