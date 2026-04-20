import { describe, expect, it } from "vitest";
import { resolveDialeticaAccount } from "./accounts.js";
import { shouldHandleDialeticaInboundForAccount } from "./inbound.js";
import {
  buildDialeticaTarget,
  normalizeDialeticaTarget,
  parseDialeticaTarget,
} from "./protocol.js";

describe("dialetica account resolution", () => {
  it("resolves merged account config with sane defaults", () => {
    const account = resolveDialeticaAccount({
      cfg: {
        channels: {
          dialetica: {
            baseUrl: "https://dialetica.example",
            botDisplayName: "Dialetica Bot",
          },
        },
      },
    });
    expect(account.accountId).toBe("default");
    expect(account.configured).toBe(true);
    expect(account.botUserId).toBe("openclaw");
    expect(account.botDisplayName).toBe("Dialetica Bot");
  });
});

describe("dialetica target parsing", () => {
  it("normalizes bare room ids", () => {
    expect(normalizeDialeticaTarget("room-123")).toBe("room:room-123");
    expect(parseDialeticaTarget("room-123")).toEqual({ roomId: "room-123" });
    expect(buildDialeticaTarget({ roomId: "room-123" })).toBe("room:room-123");
  });
});

describe("dialetica mention gating", () => {
  const account = resolveDialeticaAccount({
    cfg: {
      channels: {
        dialetica: {
          baseUrl: "https://dialetica.example",
          botUserId: "agent-123",
          botDisplayName: "Luke Eng",
        },
      },
    },
  });

  it("skips room messages with no mentions", () => {
    expect(
      shouldHandleDialeticaInboundForAccount(
        {
          id: "m1",
          room: { id: "room-1", kind: "group" },
          sender: { id: "u1", kind: "human", displayName: "Brian" },
          text: "hello team",
          timestamp: Date.now(),
          mentions: [],
        },
        account,
      ),
    ).toBe(false);
  });

  it("accepts direct rooms without mentions", () => {
    expect(
      shouldHandleDialeticaInboundForAccount(
        {
          id: "m-direct",
          room: { id: "room-1", kind: "group", mode: "direct" },
          sender: { id: "u1", kind: "human", displayName: "Brian" },
          text: "hello",
          timestamp: Date.now(),
          mentions: [],
        },
        account,
      ),
    ).toBe(true);
  });

  it("accepts messages that mention the bot display name alias", () => {
    expect(
      shouldHandleDialeticaInboundForAccount(
        {
          id: "m2",
          room: { id: "room-1", kind: "group" },
          sender: { id: "u1", kind: "human", displayName: "Brian" },
          text: "@luke-eng please reply",
          timestamp: Date.now(),
          mentions: [{ id: "dialetica:room-1:luke-eng", kind: "agent", displayName: "Luke" }],
        },
        account,
      ),
    ).toBe(true);
  });

  it("accepts messages that mention the configured bot user id", () => {
    expect(
      shouldHandleDialeticaInboundForAccount(
        {
          id: "m3",
          room: { id: "room-1", kind: "group" },
          sender: { id: "u1", kind: "human", displayName: "Brian" },
          text: "@agent-123 please reply",
          timestamp: Date.now(),
          mentions: [{ id: "agent-123", kind: "agent", displayName: "Luke Eng" }],
        },
        account,
      ),
    ).toBe(true);
  });

  it("accepts group messages targeted to a specific agent even when account aliases do not match", () => {
    expect(
      shouldHandleDialeticaInboundForAccount(
        {
          id: "m4",
          room: { id: "room-1", kind: "group", mode: "group" },
          sender: { id: "u1", kind: "human", displayName: "Brian" },
          targetAgentId: "joao",
          text: "@joao please reply",
          timestamp: Date.now(),
          mentions: [{ id: "dialetica:room-1:joao", kind: "agent", displayName: "Joao" }],
        },
        account,
      ),
    ).toBe(true);
  });
});
