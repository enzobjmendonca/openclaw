import { randomUUID } from "node:crypto";
import type { OpenClawConfig } from "openclaw/plugin-sdk/config-runtime";
import { dispatchInboundReplyWithBase } from "openclaw/plugin-sdk/inbound-reply-dispatch";
import {
  buildAgentMainSessionKey,
  buildAgentSessionKey,
  deriveLastRoutePolicy,
  type ResolvedAgentRoute,
} from "openclaw/plugin-sdk/routing";
import { sendDialeticaMessage, sendDialeticaStreamEvent } from "./client.js";
import { getDialeticaRuntime } from "./runtime.js";
import type { CoreConfig, DialeticaInboundMessage, ResolvedDialeticaAccount } from "./types.js";

const STREAM_THROTTLE_MS = 150;

function normalizeMentionToken(value: string | null | undefined): string | null {
  const trimmed = value?.trim().toLowerCase();
  return trimmed ? trimmed : null;
}

function buildMentionCandidates(account: ResolvedDialeticaAccount): Set<string> {
  const candidates = new Set<string>();
  const pushCandidate = (value: string | null | undefined) => {
    const normalized = normalizeMentionToken(value);
    if (!normalized) {
      return;
    }
    candidates.add(normalized);
    candidates.add(normalized.replace(/\s+/g, "-"));
    candidates.add(normalized.replace(/\s+/g, ""));
  };
  pushCandidate(account.botUserId);
  pushCandidate(account.botDisplayName);
  return candidates;
}

function extractMentionAlias(mentionId: string | null | undefined): string | null {
  const normalized = normalizeMentionToken(mentionId);
  if (!normalized) {
    return null;
  }
  const lastColon = normalized.lastIndexOf(":");
  return lastColon >= 0 ? normalized.slice(lastColon + 1) : normalized;
}

export function shouldHandleDialeticaInboundForAccount(
  message: DialeticaInboundMessage,
  account: ResolvedDialeticaAccount,
): boolean {
  if (message.targetAgentId) {
    return true;
  }
  if (message.room.mode === "direct") {
    return true;
  }
  if (!Array.isArray(message.mentions) || message.mentions.length === 0) {
    return false;
  }
  const candidates = buildMentionCandidates(account);
  return message.mentions.some((mention) => {
    const displayName = normalizeMentionToken(mention.displayName);
    const mentionId = normalizeMentionToken(mention.id);
    const alias = extractMentionAlias(mention.id);
    return Boolean(
      (displayName && candidates.has(displayName)) ||
      (mentionId && candidates.has(mentionId)) ||
      (alias && candidates.has(alias)),
    );
  });
}

export async function handleDialeticaInbound(params: {
  channelId: string;
  channelLabel: string;
  account: ResolvedDialeticaAccount;
  config: CoreConfig;
  message: DialeticaInboundMessage;
}) {
  if (!shouldHandleDialeticaInboundForAccount(params.message, params.account)) {
    console.info("[dialetica] skipping inbound", {
      accountId: params.account.accountId,
      roomId: params.message.room.id,
      roomMode: params.message.room.mode ?? "group",
      senderId: params.message.sender.id,
      mentionCount: params.message.mentions?.length ?? 0,
      reason: "mention-gate",
    });
    return;
  }
  const runtime = getDialeticaRuntime();
  const inbound = params.message;
  const route: ResolvedAgentRoute = inbound.targetAgentId
    ? (() => {
        const sessionKey = buildAgentSessionKey({
          agentId: inbound.targetAgentId,
          channel: params.channelId,
          accountId: params.account.accountId,
          peer: {
            kind: "group",
            id: inbound.room.id,
          },
        });
        const mainSessionKey = buildAgentMainSessionKey({
          agentId: inbound.targetAgentId,
          mainKey: "main",
        });
        return {
          agentId: inbound.targetAgentId,
          channel: params.channelId,
          accountId: params.account.accountId,
          sessionKey,
          mainSessionKey,
          lastRoutePolicy: deriveLastRoutePolicy({ sessionKey, mainSessionKey }),
          matchedBy: "default",
        };
      })()
    : runtime.channel.routing.resolveAgentRoute({
        cfg: params.config as OpenClawConfig,
        channel: params.channelId,
        accountId: params.account.accountId,
        peer: {
          kind: "group",
          id: inbound.room.id,
        },
      });
  console.info("[dialetica] handling inbound", {
    accountId: params.account.accountId,
    roomId: inbound.room.id,
    roomMode: inbound.room.mode ?? "group",
    senderId: inbound.sender.id,
    senderKind: inbound.sender.kind,
    targetAgentId: inbound.targetAgentId ?? route.agentId,
    sessionKey: route.sessionKey,
    mentionCount: inbound.mentions?.length ?? 0,
  });
  const storePath = runtime.channel.session.resolveStorePath(params.config.session?.store, {
    agentId: route.agentId,
  });
  const previousTimestamp = runtime.channel.session.readSessionUpdatedAt({
    storePath,
    sessionKey: route.sessionKey,
  });
  const body = runtime.channel.reply.formatAgentEnvelope({
    channel: params.channelLabel,
    from: inbound.sender.displayName || inbound.sender.id,
    timestamp: inbound.timestamp,
    previousTimestamp,
    envelope: runtime.channel.reply.resolveEnvelopeFormatOptions(params.config as OpenClawConfig),
    body: inbound.text,
  });
  const untrustedContext = [
    JSON.stringify({
      room_id: inbound.room.id,
      room_title: inbound.room.title,
      room_kind: inbound.room.kind,
      membership_version: inbound.room.membershipVersion,
      sender_kind: inbound.sender.kind,
      sender_alias: inbound.sender.alias,
      mentions: inbound.mentions?.map((mention) => ({
        id: mention.id,
        kind: mention.kind,
        display_name: mention.displayName,
      })),
    }),
  ];
  const ctxPayload = runtime.channel.reply.finalizeInboundContext({
    Body: body,
    BodyForAgent: inbound.text,
    RawBody: inbound.text,
    CommandBody: inbound.text,
    From: inbound.sender.id,
    To: inbound.room.id,
    SessionKey: route.sessionKey,
    AccountId: route.accountId ?? params.account.accountId,
    ChatType: "group",
    ConversationLabel: inbound.room.title || inbound.room.id,
    GroupSubject: inbound.room.title || inbound.room.id,
    NativeChannelId: inbound.room.id,
    SenderName: inbound.sender.displayName,
    SenderId: inbound.sender.id,
    Provider: params.channelId,
    Surface: params.channelId,
    MessageSid: inbound.id,
    MessageSidFull: inbound.id,
    ReplyToId: inbound.replyToId,
    Timestamp: inbound.timestamp,
    OriginatingChannel: params.channelId,
    OriginatingTo: inbound.room.id,
    CommandAuthorized: true,
    UntrustedContext: untrustedContext,
  });
  let currentMessageId: string | null = null;
  let streamedText = false;
  let streamSequence = 0;
  let textSnapshotPending: string | null = null;
  let textFlushTimer: ReturnType<typeof setTimeout> | null = null;
  let lastTextFlushAt = 0;
  let textFlushInFlight: Promise<void> | null = null;

  const logStreamFailure = (kind: string, error: unknown) => {
    console.warn("[dialetica] non-fatal stream transport failure", {
      roomId: inbound.room.id,
      targetAgentId: route.agentId,
      kind,
      error: error instanceof Error ? error.message : String(error),
    });
  };

  const sendStreamEventSafely = async (
    kind: "message_started" | "message_updated",
    buildEvent: () =>
      | {
          kind: "message_started";
          roomId: string;
          messageId: string;
          agentId?: string;
          agentName?: string;
        }
      | {
          kind: "message_updated";
          roomId: string;
          messageId: string;
          content: string;
        },
  ): Promise<void> => {
    try {
      await sendDialeticaStreamEvent({
        account: params.account,
        event: buildEvent(),
      });
    } catch (error) {
      logStreamFailure(kind, error);
    }
  };

  const ensureStreamingMessage = async () => {
    if (currentMessageId) {
      return currentMessageId;
    }
    currentMessageId = randomUUID();
    await sendStreamEventSafely("message_started", () => ({
      kind: "message_started",
      roomId: inbound.room.id,
      messageId: currentMessageId!,
      agentId: inbound.targetDialeticaAgentId,
      agentName: inbound.targetDialeticaAgentName,
    }));
    return currentMessageId;
  };

  const flushSnapshot = async (_kind: "text_delta") => {
    textFlushTimer = null;
    const content = textSnapshotPending;
    if (!content) {
      return;
    }
    textSnapshotPending = null;
    const seq = ++streamSequence;
    lastTextFlushAt = Date.now();
    textFlushInFlight = sendStreamEventSafely("message_updated", () => ({
      kind: "message_updated",
      roomId: inbound.room.id,
      messageId: currentMessageId!,
      content,
    })).finally(() => {
      if (textFlushInFlight && seq === streamSequence) {
        textFlushInFlight = null;
      }
    });
    await textFlushInFlight;
    if (textSnapshotPending) {
      scheduleSnapshotFlush("text_delta");
    }
  };

  const scheduleSnapshotFlush = (kind: "text_delta") => {
    const now = Date.now();
    if (textFlushInFlight) {
      return;
    }
    if (textFlushTimer) {
      return;
    }
    const waitMs = Math.max(0, STREAM_THROTTLE_MS - (now - lastTextFlushAt));
    if (waitMs === 0) {
      void flushSnapshot(kind);
    } else {
      textFlushTimer = setTimeout(() => {
        void flushSnapshot(kind);
      }, waitMs);
    }
  };

  const queueSnapshot = async (kind: "text_delta", content: string) => {
    if (!content) {
      return;
    }
    await ensureStreamingMessage();
    textSnapshotPending = content;
    scheduleSnapshotFlush(kind);
  };

  await dispatchInboundReplyWithBase({
    cfg: params.config as OpenClawConfig,
    channel: params.channelId,
    accountId: params.account.accountId,
    route,
    storePath,
    ctxPayload,
    core: runtime,
    replyOptions: {
      onAssistantMessageStart: async () => {
        currentMessageId = null;
        streamedText = false;
        textSnapshotPending = null;
        if (textFlushTimer) {
          clearTimeout(textFlushTimer);
          textFlushTimer = null;
        }
        await ensureStreamingMessage();
      },
      onPartialReply: async (payload) => {
        const content = String(payload.text ?? "");
        if (!content) {
          return;
        }
        streamedText = true;
        await queueSnapshot("text_delta", content);
      },
      onReasoningStream: async () => {},
    },
    deliver: async (payload) => {
      const text =
        payload && typeof payload === "object" && "text" in payload
          ? String((payload as { text?: string }).text ?? "")
          : "";
      if (!text.trim()) {
        return;
      }
      if (textFlushTimer) {
        clearTimeout(textFlushTimer);
        textFlushTimer = null;
      }
      if (textSnapshotPending) {
        await flushSnapshot("text_delta");
      }
      if (textFlushInFlight) {
        await textFlushInFlight;
      }
      const messageId = streamedText
        ? (currentMessageId ?? (await ensureStreamingMessage()))
        : undefined;
      await sendDialeticaMessage({
        account: params.account,
        message: {
          roomId: inbound.room.id,
          messageId,
          text,
          senderId: inbound.targetDialeticaAgentId,
          senderName: inbound.targetDialeticaAgentName,
          replyToId: inbound.id,
        },
      });
      console.info("[dialetica] dispatched reply", {
        roomId: inbound.room.id,
        targetAgentId: route.agentId,
        messageId: messageId ?? null,
        replyToId: inbound.id,
      });
      currentMessageId = null;
      streamedText = false;
      textSnapshotPending = null;
    },
    onRecordError: (error) => {
      throw error instanceof Error
        ? error
        : new Error(`dialetica session record failed: ${String(error)}`);
    },
    onDispatchError: (error) => {
      throw error instanceof Error
        ? error
        : new Error(`dialetica dispatch failed: ${String(error)}`);
    },
  });
}
