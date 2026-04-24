import { resolveDialeticaAccount } from "./accounts.js";
import { sendDialeticaMessage, uploadDialeticaFile } from "./client.js";
import { parseDialeticaTarget } from "./protocol.js";
import type { CoreConfig, DialeticaOutboundAttachment } from "./types.js";

export async function sendDialeticaText(params: {
  cfg: CoreConfig;
  accountId?: string | null;
  to: string;
  text: string;
  replyToId?: string | number | null;
  /** Sending agent's Dialetica member_id. Passed through to the gateway
   *  as `senderId` so the message is attributed correctly. When absent,
   *  `sendDialeticaMessage` falls back to the account's botUserId. */
  senderId?: string;
  attachments?: DialeticaOutboundAttachment[];
}) {
  const account = resolveDialeticaAccount({ cfg: params.cfg, accountId: params.accountId });
  const target = parseDialeticaTarget(params.to);
  const result = await sendDialeticaMessage({
    account,
    message: {
      roomId: target.roomId,
      text: params.text,
      senderId: params.senderId,
      replyToId: params.replyToId == null ? undefined : String(params.replyToId),
      attachments: params.attachments,
    },
  });
  return {
    to: result.roomId,
    messageId: result.messageId,
  };
}

/**
 * Upload a single local file to Dialetica, then send a message that
 * references it. Used by the channel's `sendMedia` adapter when the agent
 * emits an attachment through its `send_message` tool.
 */
export async function sendDialeticaMedia(params: {
  cfg: CoreConfig;
  accountId?: string | null;
  to: string;
  text: string;
  replyToId?: string | number | null;
  senderId?: string;
  bytes: Buffer | Uint8Array;
  name: string;
  mime: string;
}) {
  const account = resolveDialeticaAccount({ cfg: params.cfg, accountId: params.accountId });
  const uploaded = await uploadDialeticaFile({
    account,
    bytes: params.bytes,
    name: params.name,
    mime: params.mime,
  });
  return sendDialeticaText({
    cfg: params.cfg,
    accountId: params.accountId,
    to: params.to,
    text: params.text,
    replyToId: params.replyToId,
    senderId: params.senderId,
    attachments: [uploaded],
  });
}
