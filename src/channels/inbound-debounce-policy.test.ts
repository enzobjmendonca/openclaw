import { describe, expect, it, vi } from "vitest";
import {
  createChannelInboundDebouncer,
  shouldDebounceTextInbound,
} from "./inbound-debounce-policy.js";

describe("shouldDebounceTextInbound", () => {
  it("rejects blank text, media, and control commands", () => {
    const cfg = {} as Parameters<typeof shouldDebounceTextInbound>[0]["cfg"];

    expect(shouldDebounceTextInbound({ text: "   ", cfg })).toBe(false);
    expect(shouldDebounceTextInbound({ text: "hello", cfg, hasMedia: true })).toBe(false);
    expect(shouldDebounceTextInbound({ text: "/status", cfg })).toBe(false);
  });

  it("accepts normal text when debounce is allowed", () => {
    const cfg = {} as Parameters<typeof shouldDebounceTextInbound>[0]["cfg"];
    expect(shouldDebounceTextInbound({ text: "hello there", cfg })).toBe(true);
    expect(shouldDebounceTextInbound({ text: "hello there", cfg, allowDebounce: false })).toBe(
      false,
    );
  });
});

describe("createChannelInboundDebouncer", () => {
  it("resolves per-channel debounce and forwards callbacks", async () => {
    vi.useFakeTimers();
    try {
      const flushed: string[][] = [];
      const cfg = {
        messages: {
          inbound: {
            debounceMs: 10,
            byChannel: {
              "demo-channel": 25,
            },
          },
        },
      } as Parameters<typeof createChannelInboundDebouncer<{ id: string }>>[0]["cfg"];

      const { debounceMs, debouncer } = createChannelInboundDebouncer<{ id: string }>({
        cfg,
        channel: "demo-channel",
        buildKey: (item) => item.id,
        onFlush: async (items) => {
          flushed.push(items.map((entry) => entry.id));
        },
      });

      expect(debounceMs).toBe(25);

      await debouncer.enqueue({ id: "a" });
      await debouncer.enqueue({ id: "a" });
      await vi.advanceTimersByTimeAsync(30);

      expect(flushed).toEqual([["a", "a"]]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("resolves per-channel maxWaitMs from config", () => {
    const cfg = {
      messages: {
        inbound: {
          debounceMs: 10,
          maxWaitMs: 100,
          maxWaitMsByChannel: {
            "demo-channel": 250,
          },
        },
      },
    } as Parameters<typeof createChannelInboundDebouncer<{ id: string }>>[0]["cfg"];

    const { maxWaitMs } = createChannelInboundDebouncer<{ id: string }>({
      cfg,
      channel: "demo-channel",
      buildKey: (item) => item.id,
      onFlush: async () => {},
    });

    expect(maxWaitMs).toBe(250);
  });

  it("flushes via maxWaitMs cap in a continuously active room", async () => {
    vi.useFakeTimers();
    try {
      const flushed: string[][] = [];
      const cfg = {
        messages: {
          inbound: {
            debounceMs: 50,
            maxWaitMs: 120,
          },
        },
      } as Parameters<typeof createChannelInboundDebouncer<{ id: string }>>[0]["cfg"];

      const { debouncer } = createChannelInboundDebouncer<{ id: string }>({
        cfg,
        channel: "demo-channel",
        buildKey: (item) => item.id,
        onFlush: async (items) => {
          flushed.push(items.map((entry) => entry.id));
        },
      });

      // First item starts the buffer at t=0.
      await debouncer.enqueue({ id: "a" });
      // Add fresh items every 30ms — each one would normally reset the
      // 50ms trailing-edge timer, starving the buffer indefinitely.
      await vi.advanceTimersByTimeAsync(30);
      await debouncer.enqueue({ id: "a" });
      await vi.advanceTimersByTimeAsync(30);
      await debouncer.enqueue({ id: "a" });
      await vi.advanceTimersByTimeAsync(30);
      await debouncer.enqueue({ id: "a" });
      // At t=90ms with no flush yet (would have reset to 50ms on each enqueue),
      // the cap of 120ms from firstQueuedAt forces a flush at most 30ms later.
      expect(flushed).toEqual([]);
      await vi.advanceTimersByTimeAsync(35);
      expect(flushed).toEqual([["a", "a", "a", "a"]]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("calls onBufferOpened only once per buffer (first item, not subsequent)", async () => {
    vi.useFakeTimers();
    try {
      const opened: string[] = [];
      const flushed: string[][] = [];
      const cfg = {
        messages: {
          inbound: { debounceMs: 50 },
        },
      } as Parameters<typeof createChannelInboundDebouncer<{ id: string }>>[0]["cfg"];

      const { debouncer } = createChannelInboundDebouncer<{ id: string }>({
        cfg,
        channel: "demo-channel",
        buildKey: (item) => item.id,
        onBufferOpened: (item) => {
          opened.push(item.id);
        },
        onFlush: async (items) => {
          flushed.push(items.map((entry) => entry.id));
        },
      });

      await debouncer.enqueue({ id: "a" });
      await debouncer.enqueue({ id: "a" });
      await debouncer.enqueue({ id: "a" });
      // Buffer opened exactly once for key "a" despite three enqueues.
      expect(opened).toEqual(["a"]);
      await vi.advanceTimersByTimeAsync(60);
      expect(flushed).toEqual([["a", "a", "a"]]);
      // A new burst after flush opens a fresh buffer.
      await debouncer.enqueue({ id: "a" });
      expect(opened).toEqual(["a", "a"]);
      await vi.advanceTimersByTimeAsync(60);
      // A different key opens its own buffer.
      await debouncer.enqueue({ id: "b" });
      expect(opened).toEqual(["a", "a", "b"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("legacy behavior (no cap) when maxWaitMs is unset", async () => {
    vi.useFakeTimers();
    try {
      const flushed: string[][] = [];
      const cfg = {
        messages: {
          inbound: {
            debounceMs: 50,
          },
        },
      } as Parameters<typeof createChannelInboundDebouncer<{ id: string }>>[0]["cfg"];

      const { debouncer } = createChannelInboundDebouncer<{ id: string }>({
        cfg,
        channel: "demo-channel",
        buildKey: (item) => item.id,
        onFlush: async (items) => {
          flushed.push(items.map((entry) => entry.id));
        },
      });

      // Stream items every 30ms forever. Pre-cap, this would never flush.
      await debouncer.enqueue({ id: "a" });
      for (let i = 0; i < 5; i++) {
        await vi.advanceTimersByTimeAsync(30);
        await debouncer.enqueue({ id: "a" });
      }
      // Even after 150ms of streaming, no flush has happened.
      expect(flushed).toEqual([]);
      // Once the stream pauses for the full debounce window, it flushes.
      await vi.advanceTimersByTimeAsync(60);
      expect(flushed).toEqual([["a", "a", "a", "a", "a", "a"]]);
    } finally {
      vi.useRealTimers();
    }
  });
});
