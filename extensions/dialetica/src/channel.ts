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
import { sendDialeticaMedia, sendDialeticaText } from "./outbound.js";
import {
  buildDialeticaTarget,
  normalizeDialeticaTarget,
  parseDialeticaTarget,
} from "./protocol.js";
import type { ChannelPlugin } from "./runtime-api.js";
import type { CoreConfig, ResolvedDialeticaAccount } from "./types.js";

const CHANNEL_ID = "dialetica" as const;

// Minimal mime sniffer. The file service content-hashes on upload so this
// value is informational only — used for the inline render hint on the
// client and the attachment metadata.
function guessMime(name: string): string {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  const map: Record<string, string> = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    svg: "image/svg+xml",
    pdf: "application/pdf",
    txt: "text/plain",
    md: "text/markdown",
    json: "application/json",
    csv: "text/csv",
    html: "text/html",
    xml: "application/xml",
    mp3: "audio/mpeg",
    wav: "audio/wav",
    mp4: "video/mp4",
    webm: "video/webm",
    zip: "application/zip",
  };
  return map[ext] ?? "application/octet-stream";
}

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
      // Tells OpenClaw's plugin-auto-enable logic that env-var-only bootstrap
      // is a valid configuration source (matches Slack's pattern). Without
      // this, a deployment that sets DIALETICA_BASE_URL + DIALETICA_API_TOKEN
      // via env — with no `channels.dialetica` block in the config file —
      // would not auto-enable the plugin and no account would ever start.
      hasConfiguredState: ({ env }) => {
        const keys = ["DIALETICA_BASE_URL", "DIALETICA_API_TOKEN"];
        return keys.some(
          (key) => typeof env?.[key] === "string" && env[key]?.trim().length > 0,
        );
      },
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
  threading: {
    // OpenClaw's global default is "all" — every agent reply auto-threads.
    // For the Dialetica surface we want explicit-only quoting: agents only
    // tag a message as a reply when they emit [[reply_to_current]] or
    // [[reply_to:<id>]]. Setting topLevelReplyToMode here makes that the
    // per-channel default, no operator config or file edits required.
    topLevelReplyToMode: "off",
  },
  outbound: {
    base: {
      deliveryMode: "direct",
    },
    attachedResults: {
      channel: CHANNEL_ID,
      // sendText and sendMedia both extract the sending agent from
      // `ctx.agentId`. Dialetica's gateway (`POST /v1/openclaw/dialetica/
      // messages`) requires a `sender_id` that resolves to a real `members`
      // row; passing `ctx.agentId` as `senderId` is the full attribution.
      // Without ctx.agentId (system sends, no agent in scope) we fall back
      // to the account's botUserId — gateway will 4xx if that is unset,
      // which is the correct behavior.
      sendText: async ({ cfg, to, text, accountId, replyToId, agentId }) =>
        await sendDialeticaText({
          cfg: cfg as CoreConfig,
          accountId,
          to,
          text,
          replyToId,
          senderId: agentId,
        }),
      sendMedia: async ({ cfg, to, text, accountId, replyToId, agentId, mediaUrl, mediaReadFile }) => {
        if (!mediaUrl || !mediaReadFile) {
          return await sendDialeticaText({
            cfg: cfg as CoreConfig,
            accountId,
            to,
            text,
            replyToId,
            senderId: agentId,
          });
        }
        try {
          const bytes = await mediaReadFile(mediaUrl);
          const name = mediaUrl.split(/[\\/]/).pop() || "attachment";
          return await sendDialeticaMedia({
            cfg: cfg as CoreConfig,
            accountId,
            to,
            text,
            replyToId,
            senderId: agentId,
            bytes,
            name,
            mime: guessMime(name),
          });
        } catch (error) {
          console.warn("[dialetica] media send failed, falling back to text", {
            mediaUrl,
            error: error instanceof Error ? error.message : String(error),
          });
          return await sendDialeticaText({
            cfg: cfg as CoreConfig,
            accountId,
            to,
            text,
            replyToId,
            senderId: agentId,
          });
        }
      },
    },
  },
});
