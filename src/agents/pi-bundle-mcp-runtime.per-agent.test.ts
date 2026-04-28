import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanupBundleMcpHarness } from "./pi-bundle-mcp-test-harness.js";
import { __testing, materializeBundleMcpToolsForRun } from "./pi-bundle-mcp-tools.js";
import type { SessionMcpRuntime } from "./pi-bundle-mcp-types.js";

vi.mock("./embedded-pi-mcp.js", () => ({
  loadEmbeddedPiMcpConfig: (params: {
    workspaceDir: string;
    agentId?: string;
    cfg?: {
      mcp?: { servers?: Record<string, Record<string, unknown>> };
      agents?: {
        list?: Array<{
          id: string;
          mcp?: { servers?: Record<string, Record<string, unknown>> };
        }>;
      };
    };
  }) => {
    const global = params.cfg?.mcp?.servers ?? {};
    let perAgent: Record<string, Record<string, unknown>> = {};
    if (params.agentId) {
      const list = params.cfg?.agents?.list ?? [];
      const entry = list.find(
        (candidate) => candidate.id?.toLowerCase() === params.agentId?.toLowerCase(),
      );
      perAgent = entry?.mcp?.servers ?? {};
    }
    return {
      diagnostics: [],
      mcpServers: { ...global, ...perAgent },
    };
  },
}));

type RuntimeFactoryOptions = NonNullable<
  Parameters<typeof __testing.createSessionMcpRuntimeManager>[0]
>;
type RuntimeFactory = NonNullable<RuntimeFactoryOptions["createRuntime"]>;

function makeRuntime(opts: {
  sessionId: string;
  sessionKey?: string;
  workspaceDir: string;
  configFingerprint: string;
  serverUrl: string;
}): SessionMcpRuntime {
  return {
    sessionId: opts.sessionId,
    sessionKey: opts.sessionKey,
    workspaceDir: opts.workspaceDir,
    configFingerprint: opts.configFingerprint,
    createdAt: Date.now(),
    lastUsedAt: Date.now(),
    markUsed: () => {},
    getCatalog: async () => ({
      version: 1,
      generatedAt: Date.now(),
      servers: {
        composio: {
          serverName: "composio",
          launchSummary: opts.serverUrl,
          toolCount: 1,
        },
      },
      tools: [
        {
          serverName: "composio",
          safeServerName: "composio",
          toolName: "probe",
          description: opts.serverUrl,
          inputSchema: { type: "object", properties: {} },
          fallbackDescription: opts.serverUrl,
        },
      ],
    }),
    callTool: async () => ({
      content: [{ type: "text", text: opts.serverUrl }],
      isError: false,
    }),
    dispose: async () => {},
  };
}

afterEach(async () => {
  await cleanupBundleMcpHarness();
});

describe("per-agent MCP cache invalidation", () => {
  it("two agents on the same workspace get distinct fingerprints when their per-agent overlays differ", async () => {
    const created: Array<{ sessionId: string; agentId?: string; fingerprint: string }> = [];
    const createRuntime: RuntimeFactory = (params) => {
      created.push({
        sessionId: params.sessionId,
        agentId: params.agentId,
        fingerprint: params.configFingerprint ?? "missing",
      });
      const url = String(
        params.cfg?.agents?.list?.find((c: { id: string }) => c.id === params.agentId)?.mcp?.servers
          ?.composio?.url ?? "no-url",
      );
      return makeRuntime({
        sessionId: params.sessionId,
        sessionKey: params.sessionKey,
        workspaceDir: params.workspaceDir,
        configFingerprint: params.configFingerprint ?? "f0",
        serverUrl: url,
      });
    };
    const manager = __testing.createSessionMcpRuntimeManager({ createRuntime });

    const cfg = {
      agents: {
        list: [
          {
            id: "marco",
            mcp: { servers: { composio: { url: "https://example.com/mcp?user_id=marco" } } },
          },
          {
            id: "lina",
            mcp: { servers: { composio: { url: "https://example.com/mcp?user_id=lina" } } },
          },
        ],
      },
    } as unknown as Parameters<typeof manager.getOrCreate>[0]["cfg"];

    const marcoRuntime = await manager.getOrCreate({
      sessionId: "session-marco",
      sessionKey: "agent:marco:s1",
      workspaceDir: "/workspace",
      agentId: "marco",
      cfg,
    });

    const linaRuntime = await manager.getOrCreate({
      sessionId: "session-lina",
      sessionKey: "agent:lina:s1",
      workspaceDir: "/workspace",
      agentId: "lina",
      cfg,
    });

    expect(created).toHaveLength(2);
    expect(created[0].fingerprint).not.toBe(created[1].fingerprint);
    expect(marcoRuntime.configFingerprint).not.toBe(linaRuntime.configFingerprint);

    const materializedMarco = await materializeBundleMcpToolsForRun({ runtime: marcoRuntime });
    const resultMarco = await materializedMarco.tools[0].execute(
      "call-marco",
      {},
      undefined,
      undefined,
    );
    const materializedLina = await materializeBundleMcpToolsForRun({ runtime: linaRuntime });
    const resultLina = await materializedLina.tools[0].execute(
      "call-lina",
      {},
      undefined,
      undefined,
    );

    expect(resultMarco.content[0]).toMatchObject({ text: "https://example.com/mcp?user_id=marco" });
    expect(resultLina.content[0]).toMatchObject({ text: "https://example.com/mcp?user_id=lina" });
  });

  it("recreates a session runtime when the per-agent overlay changes between calls", async () => {
    const createCalls: Array<string> = [];
    const createRuntime: RuntimeFactory = (params) => {
      const url = String(
        params.cfg?.agents?.list?.find((c: { id: string }) => c.id === params.agentId)?.mcp?.servers
          ?.composio?.url ?? "no-url",
      );
      createCalls.push(url);
      return makeRuntime({
        sessionId: params.sessionId,
        sessionKey: params.sessionKey,
        workspaceDir: params.workspaceDir,
        configFingerprint: params.configFingerprint ?? "f0",
        serverUrl: url,
      });
    };
    const manager = __testing.createSessionMcpRuntimeManager({ createRuntime });

    const cfgV1 = {
      agents: {
        list: [
          {
            id: "marco",
            mcp: { servers: { composio: { url: "https://example.com/mcp?user_id=marco-v1" } } },
          },
        ],
      },
    } as unknown as Parameters<typeof manager.getOrCreate>[0]["cfg"];

    const cfgV2 = {
      agents: {
        list: [
          {
            id: "marco",
            mcp: { servers: { composio: { url: "https://example.com/mcp?user_id=marco-v2" } } },
          },
        ],
      },
    } as unknown as Parameters<typeof manager.getOrCreate>[0]["cfg"];

    const r1 = await manager.getOrCreate({
      sessionId: "session-marco-x",
      workspaceDir: "/workspace",
      agentId: "marco",
      cfg: cfgV1,
    });
    const r1again = await manager.getOrCreate({
      sessionId: "session-marco-x",
      workspaceDir: "/workspace",
      agentId: "marco",
      cfg: cfgV1,
    });
    const r2 = await manager.getOrCreate({
      sessionId: "session-marco-x",
      workspaceDir: "/workspace",
      agentId: "marco",
      cfg: cfgV2,
    });

    expect(r1).toBe(r1again);
    expect(r1).not.toBe(r2);
    expect(createCalls).toEqual([
      "https://example.com/mcp?user_id=marco-v1",
      "https://example.com/mcp?user_id=marco-v2",
    ]);
  });

  it("does not invalidate a cached runtime when no per-agent overlay change occurred", async () => {
    let createCount = 0;
    const createRuntime: RuntimeFactory = (params) => {
      createCount += 1;
      return makeRuntime({
        sessionId: params.sessionId,
        sessionKey: params.sessionKey,
        workspaceDir: params.workspaceDir,
        configFingerprint: params.configFingerprint ?? "f0",
        serverUrl: "stable",
      });
    };
    const manager = __testing.createSessionMcpRuntimeManager({ createRuntime });

    const cfg = {
      agents: {
        list: [
          {
            id: "marco",
            mcp: { servers: { composio: { url: "https://stable.example/mcp?user_id=marco" } } },
          },
        ],
      },
    } as unknown as Parameters<typeof manager.getOrCreate>[0]["cfg"];

    const a = await manager.getOrCreate({
      sessionId: "session-stable",
      workspaceDir: "/workspace",
      agentId: "marco",
      cfg,
    });
    const b = await manager.getOrCreate({
      sessionId: "session-stable",
      workspaceDir: "/workspace",
      agentId: "marco",
      cfg,
    });

    expect(a).toBe(b);
    expect(createCount).toBe(1);
  });
});
