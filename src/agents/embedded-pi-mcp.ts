import { normalizeConfiguredMcpServers } from "../config/mcp-config.js";
import type { OpenClawConfig } from "../config/types.openclaw.js";
import type { BundleMcpDiagnostic, BundleMcpServerConfig } from "../plugins/bundle-mcp.js";
import { loadEnabledBundleMcpConfig } from "../plugins/bundle-mcp.js";
import { normalizeAgentId } from "../routing/session-key.js";

export type EmbeddedPiMcpConfig = {
  mcpServers: Record<string, BundleMcpServerConfig>;
  diagnostics: BundleMcpDiagnostic[];
};

/**
 * Resolve the merged MCP server map a session should see.
 *
 * Three layers, in increasing precedence on name collisions:
 *
 *   1. **Bundle MCP** — servers contributed by enabled plugin bundles
 *      installed in the agent's workspace.
 *   2. **Global** `cfg.mcp.servers` — operator-managed registry shared
 *      across the runtime.
 *   3. **Per-agent** `cfg.agents.list[id=agentId].mcp.servers` — overlay
 *      tied to a specific agent. Enables multi-tenant isolation when
 *      multiple agents in one runtime each need their own scoped MCP
 *      endpoint (e.g., per-agent Composio user_id). Per-agent wins on
 *      name collisions.
 *
 * The optional `agentId` parameter is normalized via `normalizeAgentId`
 * before lookup so case/format drift between callers does not break the
 * match. When `agentId` is omitted (legacy callers, no per-agent
 * intent), the per-agent layer is empty and behavior matches the prior
 * two-layer merge exactly.
 */
export function loadEmbeddedPiMcpConfig(params: {
  workspaceDir: string;
  agentId?: string;
  cfg?: OpenClawConfig;
}): EmbeddedPiMcpConfig {
  const bundleMcp = loadEnabledBundleMcpConfig({
    workspaceDir: params.workspaceDir,
    cfg: params.cfg,
  });
  const configuredMcp = normalizeConfiguredMcpServers(params.cfg?.mcp?.servers);
  const perAgentMcp = resolvePerAgentMcpServers(params.cfg, params.agentId);

  return {
    mcpServers: {
      ...bundleMcp.config.mcpServers,
      ...configuredMcp,
      ...perAgentMcp,
    },
    diagnostics: bundleMcp.diagnostics,
  };
}

function resolvePerAgentMcpServers(
  cfg: OpenClawConfig | undefined,
  agentId: string | undefined,
): Record<string, BundleMcpServerConfig> {
  if (!agentId) return {};
  const targetId = normalizeAgentId(agentId);
  if (!targetId) return {};
  const list = cfg?.agents?.list;
  if (!Array.isArray(list)) return {};
  const entry = list.find(
    (candidate) =>
      candidate &&
      typeof candidate === "object" &&
      typeof (candidate as { id?: unknown }).id === "string" &&
      normalizeAgentId((candidate as { id: string }).id) === targetId,
  );
  if (!entry) return {};
  const servers = (entry as { mcp?: { servers?: unknown } }).mcp?.servers;
  return normalizeConfiguredMcpServers(servers);
}
