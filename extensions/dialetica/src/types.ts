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
  /**
   * Total active members in the room (humans + agents). Used by the inbound
   * debouncer to scale its trailing-edge wait sub-linearly with room size.
   * Optional for backward compatibility with older gateway payloads.
   */
  memberCount?: number;
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
    }
  | {
      // Emitted when the inbound debouncer opens a buffer and the agent is
      // queued to run after the coalesce window. No messageId yet — the run
      // hasn't started. The frontend renders this the same way it renders
      // `message_working`, so users see "<agent> is thinking" during the
      // 3-15s wait instead of dead silence.
      kind: "agent_thinking";
      roomId: string;
      agentId?: string;
      agentName?: string;
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
