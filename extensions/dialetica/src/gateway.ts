import {
  createChannelInboundDebouncer,
  shouldDebounceTextInbound,
} from "openclaw/plugin-sdk/channel-inbound";
import { sendDialeticaStreamEvent, subscribeDialeticaEventsWs } from "./client.js";
import {
  handleDialeticaInbound,
  shouldHandleDialeticaInboundForAccount,
} from "./inbound.js";
import type { ChannelGatewayContext } from "./runtime-api.js";
import type {
  CoreConfig,
  DialeticaInboundMessage,
  ResolvedDialeticaAccount,
} from "./types.js";

const DIALETICA_CHANNEL_ID = "dialetica";

// Dynamic-debounce policy. Mirrors the design discussed for the dialetica
// channel:
//   - 2-member room (de-facto 1-1)         → fastDebounceMs
//   - Group with @me-mentioned             → fastDebounceMs
//   - Group, no mention                    → sub-linear sqrt scaling, capped
// Numbers can be tuned via cfg.messages.inbound.{debounceMs, maxWaitMs} or the
// per-channel overrides; the values below are sensible defaults when nothing
// is configured.
const FAST_DEBOUNCE_MS = 3_000;
const GROUP_BASE_DEBOUNCE_MS = 3_000;
const GROUP_PER_PEER_DEBOUNCE_MS = 1_500;
const GROUP_DEBOUNCE_CEILING_MS = 15_000;
const DEFAULT_MAX_WAIT_MS = 60_000;

function resolveDialeticaWindowMs(params: {
  message: DialeticaInboundMessage;
  account: ResolvedDialeticaAccount;
}): number {
  const { message, account } = params;
  const memberCount = message.room.memberCount ?? 2;
  if (memberCount <= 2) {
    return FAST_DEBOUNCE_MS;
  }
  if (shouldHandleDialeticaInboundForAccount(message, account)) {
    // The mention gate fires when this account is explicitly addressed
    // (direct, targeted, or @-mentioned). Promote to fast window regardless
    // of room size — the user is waiting on this specific agent.
    return FAST_DEBOUNCE_MS;
  }
  // Sub-linear scaling for larger rooms. sqrt(N-1) keeps mid-size groups
  // (3-10 members) responsive while large rooms (50+) hit the ceiling
  // gracefully instead of imposing pathologically long waits.
  const peers = Math.max(0, memberCount - 1);
  const dynamic = GROUP_BASE_DEBOUNCE_MS + GROUP_PER_PEER_DEBOUNCE_MS * Math.sqrt(peers);
  return Math.min(GROUP_DEBOUNCE_CEILING_MS, Math.round(dynamic));
}

type DialeticaDebounceEntry = {
  channelId: string;
  channelLabel: string;
  account: ResolvedDialeticaAccount;
  config: CoreConfig;
  message: DialeticaInboundMessage;
};

function buildDialeticaDebounceKey(entry: DialeticaDebounceEntry): string {
  // Per-(account, room, recipient agent). Different agents in the same room
  // run independently — coalescing only collapses messages that target the
  // same agent.
  const agentId =
    entry.message.targetAgentId ??
    entry.message.targetDialeticaAgentId ??
    "default";
  return `${entry.account.accountId}:${entry.message.room.id}:${agentId}`;
}

export async function startDialeticaGatewayAccount(
  channelId: string,
  channelLabel: string,
  ctx: ChannelGatewayContext<ResolvedDialeticaAccount>,
) {
  const account = ctx.account;
  console.info("[dialetica] startAccount called", {
    accountId: account.accountId,
    configured: account.configured,
    enabled: account.enabled,
    baseUrl: account.baseUrl || "<empty>",
  });
  if (!account.configured) {
    console.warn(
      `[dialetica] account "${account.accountId}" not configured; set channels.dialetica.baseUrl in config, ` +
        `or DIALETICA_BASE_URL + DIALETICA_API_TOKEN in env.`,
    );
    throw new Error(`Dialetica is not configured for account "${account.accountId}"`);
  }
  ctx.setStatus({
    accountId: account.accountId,
    running: true,
    configured: true,
    enabled: account.enabled,
    baseUrl: account.baseUrl,
  });
  // One debouncer per account. Buckets by (account, room, agent) — each
  // recipient agent in the same room coalesces independently. onFlush takes
  // entries.at(-1) as the trigger; earlier burst entries are dropped from
  // this turn's prompt but remain in the chat's persisted history server-side.
  // If config sets messages.inbound.debounceMs / maxWaitMs / byChannel, those
  // override the defaults below; otherwise we use the static defaults via
  // resolveDebounceMs (and the conservative DEFAULT_MAX_WAIT_MS).
  const { debouncer } = createChannelInboundDebouncer<DialeticaDebounceEntry>({
    cfg: ctx.cfg as CoreConfig,
    channel: DIALETICA_CHANNEL_ID,
    debounceMsOverride: GROUP_DEBOUNCE_CEILING_MS,
    maxWaitMsOverride: DEFAULT_MAX_WAIT_MS,
    buildKey: buildDialeticaDebounceKey,
    shouldDebounce: (entry) =>
      shouldDebounceTextInbound({
        text: entry.message.text,
        cfg: entry.config as Parameters<typeof shouldDebounceTextInbound>[0]["cfg"],
        hasMedia: Boolean(
          (entry.message as DialeticaInboundMessage & { mediaUrls?: string[] }).mediaUrls?.length,
        ),
      }),
    resolveDebounceMs: (entry) =>
      resolveDialeticaWindowMs({ message: entry.message, account: entry.account }),
    onFlush: async (entries) => {
      const last = entries.at(-1);
      if (!last) {
        return;
      }
      if (entries.length > 1) {
        console.info("[dialetica] debounce-flushed burst", {
          accountId: last.account.accountId,
          roomId: last.message.room.id,
          targetAgentId:
            last.message.targetAgentId ?? last.message.targetDialeticaAgentId ?? null,
          burstSize: entries.length,
          // TODO: populate InboundHistory from the dropped earlier entries so
          // the agent reads the room rather than only the last message.
        });
      }
      await handleDialeticaInbound({
        channelId: last.channelId,
        channelLabel: last.channelLabel,
        account: last.account,
        config: last.config,
        message: last.message,
      });
    },
    onError: (error) => {
      console.warn("[dialetica] inbound dispatch failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    },
    onBufferOpened: (entry) => {
      // Frontend uses this to render "<agent> is thinking" while we wait
      // for the coalesce window to close. Best-effort — failures here are
      // strictly cosmetic and must not block dispatch.
      const targetAgent =
        entry.message.targetDialeticaAgentId ?? entry.message.targetAgentId;
      if (!targetAgent) {
        return;
      }
      void sendDialeticaStreamEvent({
        account: entry.account,
        event: {
          kind: "agent_thinking",
          roomId: entry.message.room.id,
          agentId: targetAgent,
          agentName: entry.message.targetDialeticaAgentName,
        },
      }).catch((error) => {
        console.warn("[dialetica] agent_thinking emit failed", {
          accountId: entry.account.accountId,
          roomId: entry.message.room.id,
          agentId: targetAgent,
          error: error instanceof Error ? error.message : String(error),
        });
      });
    },
  });
  let cursor = Date.now() - 1_000;
  console.info("[dialetica] gateway account started", {
    accountId: account.accountId,
    initialCursor: cursor,
    baseUrl: account.baseUrl,
  });
  try {
    while (!ctx.abortSignal.aborted) {
      cursor = await subscribeDialeticaEventsWs({
        account,
        cursor,
        signal: ctx.abortSignal,
        onEvents: async (result) => {
          for (const event of result.events) {
            if (event.kind !== "message") {
              continue;
            }
            await debouncer.enqueue({
              channelId,
              channelLabel,
              account,
              config: ctx.cfg as CoreConfig,
              message: event.message,
            });
          }
        },
      });
      if (!ctx.abortSignal.aborted) {
        await new Promise((resolve) => setTimeout(resolve, 1_000));
      }
    }
  } catch (error) {
    if (!(error instanceof Error) || error.name !== "AbortError") {
      throw error;
    }
  }
  ctx.setStatus({
    accountId: account.accountId,
    running: false,
  });
}
