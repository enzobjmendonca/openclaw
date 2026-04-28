import { z } from "zod";
import { sensitive } from "./zod-schema.sensitive.js";

const HttpUrlString = z.string().url();

/**
 * Shape of one MCP server entry, shared between the global
 * `mcp.servers.<name>` registry and the per-agent
 * `agents.list[].mcp.servers.<name>` overlay introduced by the
 * per-agent-MCP overlay patch (see docs/design/per-agent-mcp.md).
 *
 * Headers and env values are restricted to scalars today. SecretRef
 * support is added in a follow-up step (option B in the design doc);
 * until that lands, callers must resolve secrets to literals before
 * writing the config.
 */
export const McpServerSchema = z
  .object({
    command: z.string().optional(),
    args: z.array(z.string()).optional(),
    env: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
    cwd: z.string().optional(),
    workingDirectory: z.string().optional(),
    url: HttpUrlString.optional(),
    headers: z
      .record(
        z.string(),
        z.union([z.string().register(sensitive), z.number(), z.boolean()]).register(sensitive),
      )
      .optional(),
  })
  .catchall(z.unknown());

/**
 * Shape of an `mcp` config block. Used at the top level
 * (`cfg.mcp.servers`) and at the per-agent level
 * (`cfg.agents.list[].mcp.servers`). Per-agent entries are merged over
 * the global registry at session-create time; per-agent wins on name
 * collisions.
 */
export const McpConfigSchema = z
  .object({
    servers: z.record(z.string(), McpServerSchema).optional(),
  })
  .strict();
