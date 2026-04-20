import { resolveDialeticaAccount } from "./accounts.js";
import { sendDialeticaMessage } from "./client.js";
import { parseDialeticaTarget } from "./protocol.js";
import type { CoreConfig } from "./types.js";

export async function sendDialeticaText(params: {
  cfg: CoreConfig;
  accountId?: string | null;
  to: string;
  text: string;
  replyToId?: string | number | null;
}) {
  const account = resolveDialeticaAccount({ cfg: params.cfg, accountId: params.accountId });
  const target = parseDialeticaTarget(params.to);
  const result = await sendDialeticaMessage({
    account,
    message: {
      roomId: target.roomId,
      text: params.text,
      replyToId: params.replyToId == null ? undefined : String(params.replyToId),
    },
  });
  return {
    to: result.roomId,
    messageId: result.messageId,
  };
}
