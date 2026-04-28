import { describe, expect, it, vi } from "vitest";

// Mock the bundle-mcp loader so we don't have to set up plugin fixtures on
// disk. We always return an empty bundle layer; the tests focus on the
// global vs per-agent precedence.
vi.mock("../plugins/bundle-mcp.js", () => ({
  loadEnabledBundleMcpConfig: () => ({
    config: { mcpServers: {} },
    diagnostics: [],
  }),
}));

import type { OpenClawConfig } from "../config/types.openclaw.js";
import { loadEmbeddedPiMcpConfig } from "./embedded-pi-mcp.js";

const WORKSPACE = "/virtual/workspace";

function buildConfig(input: {
  global?: Record<string, Record<string, unknown>>;
  agents?: Array<{ id: string; mcp?: { servers?: Record<string, Record<string, unknown>> } }>;
}): OpenClawConfig {
  const cfg: Record<string, unknown> = {};
  if (input.global) {
    cfg.mcp = { servers: input.global };
  }
  if (input.agents) {
    cfg.agents = { list: input.agents };
  }
  return cfg as unknown as OpenClawConfig;
}

describe("loadEmbeddedPiMcpConfig — three-layer merge", () => {
  it("returns only global servers when no agentId is provided", () => {
    const cfg = buildConfig({
      global: {
        "shared-tool": { url: "https://shared.example/mcp" },
      },
      agents: [
        {
          id: "marco",
          mcp: { servers: { "shared-tool": { url: "https://marco.example/mcp" } } },
        },
      ],
    });

    const result = loadEmbeddedPiMcpConfig({ workspaceDir: WORKSPACE, cfg });

    expect(result.mcpServers["shared-tool"]).toEqual({ url: "https://shared.example/mcp" });
  });

  it("isolates two agents — each sees its own MCP server URL", () => {
    const cfg = buildConfig({
      agents: [
        {
          id: "marco",
          mcp: {
            servers: {
              composio: { url: "https://backend.composio.dev/v3/mcp/server-x?user_id=marco" },
            },
          },
        },
        {
          id: "lina",
          mcp: {
            servers: {
              composio: { url: "https://backend.composio.dev/v3/mcp/server-x?user_id=lina" },
            },
          },
        },
      ],
    });

    const marco = loadEmbeddedPiMcpConfig({ workspaceDir: WORKSPACE, agentId: "marco", cfg });
    const lina = loadEmbeddedPiMcpConfig({ workspaceDir: WORKSPACE, agentId: "lina", cfg });

    expect(marco.mcpServers.composio).toEqual({
      url: "https://backend.composio.dev/v3/mcp/server-x?user_id=marco",
    });
    expect(lina.mcpServers.composio).toEqual({
      url: "https://backend.composio.dev/v3/mcp/server-x?user_id=lina",
    });
    // The two agents must not see each other's overlay.
    expect(marco.mcpServers.composio).not.toEqual(lina.mcpServers.composio);
  });

  it("per-agent overlay wins on name collisions over global", () => {
    const cfg = buildConfig({
      global: {
        composio: { url: "https://global.example/mcp" },
      },
      agents: [
        {
          id: "marco",
          mcp: { servers: { composio: { url: "https://marco.example/mcp" } } },
        },
      ],
    });

    const result = loadEmbeddedPiMcpConfig({ workspaceDir: WORKSPACE, agentId: "marco", cfg });

    expect(result.mcpServers.composio).toEqual({ url: "https://marco.example/mcp" });
  });

  it("merges per-agent and global names side-by-side when keys differ", () => {
    const cfg = buildConfig({
      global: {
        "shared-tool": { url: "https://shared.example/mcp" },
      },
      agents: [
        {
          id: "marco",
          mcp: { servers: { composio: { url: "https://marco.example/mcp" } } },
        },
      ],
    });

    const result = loadEmbeddedPiMcpConfig({ workspaceDir: WORKSPACE, agentId: "marco", cfg });

    expect(Object.keys(result.mcpServers).sort()).toEqual(["composio", "shared-tool"]);
  });

  it("falls back to global only when the agent has no per-agent overlay", () => {
    const cfg = buildConfig({
      global: {
        "shared-tool": { url: "https://shared.example/mcp" },
      },
      agents: [{ id: "marco" }],
    });

    const result = loadEmbeddedPiMcpConfig({ workspaceDir: WORKSPACE, agentId: "marco", cfg });

    expect(result.mcpServers).toEqual({ "shared-tool": { url: "https://shared.example/mcp" } });
  });

  it("falls back to global only when agentId does not match any list entry", () => {
    const cfg = buildConfig({
      global: {
        "shared-tool": { url: "https://shared.example/mcp" },
      },
      agents: [
        {
          id: "marco",
          mcp: { servers: { composio: { url: "https://marco.example/mcp" } } },
        },
      ],
    });

    const result = loadEmbeddedPiMcpConfig({
      workspaceDir: WORKSPACE,
      agentId: "stranger",
      cfg,
    });

    expect(result.mcpServers).toEqual({ "shared-tool": { url: "https://shared.example/mcp" } });
    expect(result.mcpServers).not.toHaveProperty("composio");
  });

  it("normalizes agentId case so 'Marco' matches 'marco'", () => {
    const cfg = buildConfig({
      agents: [
        {
          id: "marco",
          mcp: { servers: { composio: { url: "https://marco.example/mcp" } } },
        },
      ],
    });

    const result = loadEmbeddedPiMcpConfig({ workspaceDir: WORKSPACE, agentId: "Marco", cfg });

    expect(result.mcpServers.composio).toEqual({ url: "https://marco.example/mcp" });
  });

  it("returns an empty server map when there is no global, no per-agent, and no bundle config", () => {
    const result = loadEmbeddedPiMcpConfig({
      workspaceDir: WORKSPACE,
      cfg: {} as OpenClawConfig,
    });
    expect(result.mcpServers).toEqual({});
    expect(result.diagnostics).toEqual([]);
  });

  it("ignores per-agent overlay if cfg.agents.list is missing", () => {
    const cfg = buildConfig({
      global: { "shared-tool": { url: "https://shared.example/mcp" } },
    });
    const result = loadEmbeddedPiMcpConfig({
      workspaceDir: WORKSPACE,
      agentId: "marco",
      cfg,
    });
    expect(result.mcpServers).toEqual({ "shared-tool": { url: "https://shared.example/mcp" } });
  });

  it("does not leak per-agent server to a different agent", () => {
    const cfg = buildConfig({
      agents: [
        {
          id: "marco",
          mcp: {
            servers: {
              "marco-only": { url: "https://marco.example/mcp" },
            },
          },
        },
        {
          id: "lina",
          mcp: { servers: { "lina-only": { url: "https://lina.example/mcp" } } },
        },
      ],
    });

    const marco = loadEmbeddedPiMcpConfig({ workspaceDir: WORKSPACE, agentId: "marco", cfg });
    const lina = loadEmbeddedPiMcpConfig({ workspaceDir: WORKSPACE, agentId: "lina", cfg });

    expect(marco.mcpServers).toHaveProperty("marco-only");
    expect(marco.mcpServers).not.toHaveProperty("lina-only");
    expect(lina.mcpServers).toHaveProperty("lina-only");
    expect(lina.mcpServers).not.toHaveProperty("marco-only");
  });

  it("merges bundle layer below global and per-agent", async () => {
    vi.resetModules();
    vi.doMock("../plugins/bundle-mcp.js", () => ({
      loadEnabledBundleMcpConfig: () => ({
        config: {
          mcpServers: {
            "bundle-only": { url: "https://bundle.example/mcp" },
            "shared-tool": { url: "https://bundle-shared.example/mcp" },
          },
        },
        diagnostics: [],
      }),
    }));
    const { loadEmbeddedPiMcpConfig: load } = await import("./embedded-pi-mcp.js");

    const cfg = buildConfig({
      global: { "shared-tool": { url: "https://global-shared.example/mcp" } },
      agents: [
        {
          id: "marco",
          mcp: { servers: { "shared-tool": { url: "https://marco-shared.example/mcp" } } },
        },
      ],
    });

    const result = load({ workspaceDir: WORKSPACE, agentId: "marco", cfg });

    expect(result.mcpServers["bundle-only"]).toEqual({ url: "https://bundle.example/mcp" });
    expect(result.mcpServers["shared-tool"]).toEqual({ url: "https://marco-shared.example/mcp" });

    vi.doUnmock("../plugins/bundle-mcp.js");
    vi.resetModules();
  });
});
