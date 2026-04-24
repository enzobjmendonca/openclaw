export type DialeticaMemberKind = "human" | "agent" | "system";

export type DialeticaMention = {
  id: string;
  kind: DialeticaMemberKind;
  displayName?: string;
};

export type DialeticaSender = {
  id: string;
  kind: DialeticaMemberKind;
  displayName?: string;
  alias?: string;
};

export type DialeticaRoom = {
  id: string;
  title?: string;
  kind: "group";
  mode?: "group" | "direct";
  threadId?: null;
  membershipVersion?: string;
};

export type DialeticaInboundMessage = {
  id: string;
  room: DialeticaRoom;
  sender: DialeticaSender;
  targetAgentId?: string;
  targetDialeticaAgentId?: string;
  targetDialeticaAgentName?: string;
  text: string;
  timestamp: number;
  replyToId?: string;
  mentions?: DialeticaMention[];
};

export type DialeticaPollEvent =
  | {
      cursor: number;
      kind: "message";
      accountId: string;
      message: DialeticaInboundMessage;
    }
  | {
      cursor: number;
      kind: "membership-updated";
      accountId: string;
      roomId: string;
      membershipVersion: string;
    };

export type DialeticaPollResult = {
  cursor: number;
  events: DialeticaPollEvent[];
};

export type DialeticaWsServerFrame =
  | {
      type: "ready";
      cursor: number;
    }
  | {
      type: "event_envelope";
      envelopeId: string;
      cursor: number;
      event: DialeticaPollEvent;
    }
  | {
      type: "error";
      error: string;
    };

export type DialeticaWsClientFrame = {
  type: "ack";
  envelopeId: string;
  cursor: number;
};

export type DialeticaOutboundAttachment = {
  fileId: string;
  name: string;
  mime: string;
  size: number;
};

export type DialeticaOutboundMessageInput = {
  accountId?: string;
  roomId: string;
  text: string;
  messageId?: string;
  senderId?: string;
  senderName?: string;
  replyToId?: string;
  /** File references already uploaded to Dialetica's /v1/files/upload. */
  attachments?: DialeticaOutboundAttachment[];
};

export type DialeticaStreamEventInput =
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
    };

export type DialeticaAccountConfig = {
  name?: string;
  enabled?: boolean;
  baseUrl?: string;
  apiToken?: string;
  botUserId?: string;
  botDisplayName?: string;
  allowFrom?: Array<string | number>;
  defaultTo?: string;
};

export type DialeticaConfig = DialeticaAccountConfig & {
  accounts?: Record<string, Partial<DialeticaAccountConfig>>;
  defaultAccount?: string;
};

export type CoreConfig = {
  channels?: {
    dialetica?: DialeticaConfig;
  };
  session?: {
    store?: string;
  };
};

export type ResolvedDialeticaAccount = {
  accountId: string;
  enabled: boolean;
  configured: boolean;
  name?: string;
  baseUrl: string;
  apiToken?: string;
  botUserId: string;
  botDisplayName: string;
  config: DialeticaAccountConfig;
};
