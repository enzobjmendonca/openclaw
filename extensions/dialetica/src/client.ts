import WebSocket from "ws";
import { buildDialeticaTarget, parseDialeticaTarget } from "./protocol.js";
import type {
  DialeticaOutboundMessageInput,
  DialeticaStreamEventInput,
  DialeticaPollResult,
  DialeticaWsClientFrame,
  DialeticaWsServerFrame,
  ResolvedDialeticaAccount,
} from "./types.js";

function buildHeaders(account: ResolvedDialeticaAccount): Record<string, string> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (account.apiToken) {
    headers.authorization = `Bearer ${account.apiToken}`;
  }
  return headers;
}

async function readJson<T>(response: Response, label: string): Promise<T> {
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`${label} failed (${response.status}): ${text.slice(0, 500)}`);
  }
  return (await response.json()) as T;
}

function toDialeticaWsUrl(baseUrl: string): URL {
  const url = new URL("/v1/openclaw/dialetica/ws", baseUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url;
}

export async function subscribeDialeticaEventsWs(params: {
  account: ResolvedDialeticaAccount;
  cursor: number;
  signal: AbortSignal;
  onEvents: (result: DialeticaPollResult) => Promise<void> | void;
}): Promise<number> {
  const url = toDialeticaWsUrl(params.account.baseUrl);
  url.searchParams.set("accountId", params.account.accountId);
  url.searchParams.set("cursor", String(params.cursor));

  return await new Promise<number>((resolve, reject) => {
    let settled = false;
    let currentCursor = params.cursor;
    const ws = new WebSocket(url, [], {
      headers: buildHeaders(params.account),
    });

    const finish = (fn: () => void) => {
      if (settled) {
        return;
      }
      settled = true;
      fn();
    };

    const abortHandler = () => {
      try {
        ws.close();
      } catch {
        // ignore close errors during shutdown
      }
      finish(() => resolve(currentCursor));
    };

    params.signal.addEventListener("abort", abortHandler, { once: true });

    ws.on("message", async (raw: Buffer) => {
      try {
        const frame = JSON.parse(raw.toString("utf-8")) as DialeticaWsServerFrame;
        if (frame.type === "ready") {
          currentCursor = frame.cursor;
          console.info("[dialetica] websocket ready", {
            accountId: params.account.accountId,
            cursor: currentCursor,
          });
          return;
        }
        if (frame.type === "error") {
          finish(() => reject(new Error(`Dialetica websocket failed: ${frame.error}`)));
          return;
        }
        currentCursor = frame.cursor;
        console.info("[dialetica] websocket event", {
          accountId: params.account.accountId,
          cursor: params.cursor,
          nextCursor: frame.cursor,
          eventKind: frame.event.kind,
          envelopeId: frame.envelopeId,
        });
        await params.onEvents({
          cursor: frame.cursor,
          events: [frame.event],
        });
        const ack: DialeticaWsClientFrame = {
          type: "ack",
          envelopeId: frame.envelopeId,
          cursor: frame.cursor,
        };
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify(ack));
        }
      } catch (error) {
        finish(() => reject(error instanceof Error ? error : new Error(String(error))));
      }
    });

    ws.on("close", () => {
      finish(() => resolve(currentCursor));
    });

    ws.on("error", (error) => {
      finish(() => reject(error));
    });
  });
}

export async function sendDialeticaMessage(params: {
  account: ResolvedDialeticaAccount;
  message: DialeticaOutboundMessageInput;
}): Promise<{ roomId: string; messageId: string }> {
  const room = parseDialeticaTarget(params.message.roomId);
  const attachments = params.message.attachments?.map((a) => ({
    file_id: a.fileId,
    name: a.name,
    mime: a.mime,
    size: a.size,
  }));
  const response = await fetch(new URL("/v1/openclaw/dialetica/messages", params.account.baseUrl), {
    method: "POST",
    headers: buildHeaders(params.account),
    body: JSON.stringify({
      accountId: params.account.accountId,
      roomId: room.roomId,
      messageId: params.message.messageId,
      text: params.message.text,
      senderId: params.message.senderId ?? params.account.botUserId,
      senderName: params.message.senderName ?? params.account.botDisplayName,
      replyToId: params.message.replyToId,
      ...(attachments && attachments.length > 0 ? { attachments } : {}),
    }),
  });
  const data = await readJson<{ roomId?: string; messageId: string }>(response, "Dialetica send");
  console.info("[dialetica] sent reply", {
    accountId: params.account.accountId,
    roomId: room.roomId,
    messageId: data.messageId,
    replyToId: params.message.replyToId ?? null,
    attachmentCount: attachments?.length ?? 0,
  });
  return {
    roomId: data.roomId ?? buildDialeticaTarget(room),
    messageId: data.messageId,
  };
}

/**
 * Upload a file to Dialetica's /v1/files/upload. Returns the file_id plus
 * the echoed metadata, ready to feed into `sendDialeticaMessage` as an
 * attachment. The gateway content-hashes + dedups on the file-service side,
 * so re-uploading identical bytes is cheap and idempotent.
 */
export async function uploadDialeticaFile(params: {
  account: ResolvedDialeticaAccount;
  bytes: Buffer | Uint8Array;
  name: string;
  mime: string;
}): Promise<{ fileId: string; name: string; mime: string; size: number }> {
  const form = new FormData();
  // TS's Blob type narrows BlobPart to Uint8Array<ArrayBuffer>, but Buffer
  // (and Uint8Array<ArrayBufferLike>) overlap structurally — cast through
  // BlobPart to bridge the two.
  const blob = new Blob([params.bytes as unknown as BlobPart], { type: params.mime });
  form.append("file", blob, params.name);
  form.append("name", params.name);
  form.append("mime", params.mime);

  const headers: Record<string, string> = {};
  if (params.account.apiToken) {
    headers.authorization = `Bearer ${params.account.apiToken}`;
  }
  const response = await fetch(new URL("/v1/files/upload", params.account.baseUrl), {
    method: "POST",
    headers, // NOTE: do not set content-type; fetch + FormData handle the multipart boundary
    body: form,
  });
  const data = await readJson<{ file_id: string; name: string; mime: string; size: number }>(
    response,
    "Dialetica file upload",
  );
  return {
    fileId: data.file_id,
    name: data.name,
    mime: data.mime,
    size: data.size,
  };
}

export async function sendDialeticaStreamEvent(params: {
  account: ResolvedDialeticaAccount;
  event: DialeticaStreamEventInput;
}): Promise<void> {
  const room = parseDialeticaTarget(params.event.roomId);
  const response = await fetch(new URL("/v1/openclaw/dialetica/stream", params.account.baseUrl), {
    method: "POST",
    headers: buildHeaders(params.account),
    body: JSON.stringify({
      accountId: params.account.accountId,
      roomId: room.roomId,
      event:
        params.event.kind === "message_started"
          ? {
              kind: params.event.kind,
              messageId: params.event.messageId,
              agentId: params.event.agentId,
              agentName: params.event.agentName,
            }
          : {
              kind: params.event.kind,
              messageId: params.event.messageId,
              content: params.event.content,
            },
    }),
  });
  await readJson<{ ok: true }>(response, "Dialetica stream");
  console.info("[dialetica] sent stream event", {
    accountId: params.account.accountId,
    roomId: room.roomId,
    kind: params.event.kind,
    messageId: params.event.messageId,
    contentLength: "content" in params.event ? params.event.content.length : 0,
    contentPreview:
      "content" in params.event && typeof params.event.content === "string"
        ? params.event.content.slice(0, 120)
        : undefined,
  });
}
