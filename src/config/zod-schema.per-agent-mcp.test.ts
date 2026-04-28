import { describe, expect, it } from "vitest";
import { OpenClawSchema } from "./zod-schema.js";

function expectParse(input: unknown): ReturnType<typeof OpenClawSchema.safeParse> {
  return OpenClawSchema.safeParse(input);
}

describe("zod schema — agents.list[].mcp overlay", () => {
  it("accepts a valid HTTP per-agent MCP server", () => {
    const result = expectParse({
      agents: {
        list: [
          {
            id: "marco",
            mcp: {
              servers: {
                composio: {
                  url: "https://backend.composio.dev/v3/mcp/srv-1?user_id=marco",
                  headers: { Authorization: "Bearer redacted" },
                },
              },
            },
          },
        ],
      },
    });
    expect(result.success).toBe(true);
  });

  it("accepts a valid stdio per-agent MCP server", () => {
    const result = expectParse({
      agents: {
        list: [
          {
            id: "marco",
            mcp: {
              servers: {
                local: {
                  command: "node",
                  args: ["./mcp-server.mjs"],
                  env: { TOKEN: "abc" },
                  cwd: "/srv",
                },
              },
            },
          },
        ],
      },
    });
    expect(result.success).toBe(true);
  });

  it("accepts an empty servers map (clear overlay shape)", () => {
    const result = expectParse({
      agents: { list: [{ id: "marco", mcp: { servers: {} } }] },
    });
    expect(result.success).toBe(true);
  });

  it("accepts an absent mcp property (per-agent overlay is optional)", () => {
    const result = expectParse({ agents: { list: [{ id: "marco" }] } });
    expect(result.success).toBe(true);
  });

  it("rejects unknown top-level keys inside an agent's mcp block (strict)", () => {
    const result = expectParse({
      agents: {
        list: [
          {
            id: "marco",
            mcp: {
              servers: {},
              fakeField: "no",
            },
          },
        ],
      },
    });
    expect(result.success).toBe(false);
  });

  it("rejects a non-URL value for `url`", () => {
    const result = expectParse({
      agents: {
        list: [
          {
            id: "marco",
            mcp: { servers: { composio: { url: "not a url" } } },
          },
        ],
      },
    });
    expect(result.success).toBe(false);
  });

  it("rejects header values that are not string/number/boolean (e.g. nested objects)", () => {
    const result = expectParse({
      agents: {
        list: [
          {
            id: "marco",
            mcp: {
              servers: {
                composio: {
                  url: "https://example.com/mcp",
                  headers: { "x-evil": { nested: true } as unknown as string },
                },
              },
            },
          },
        ],
      },
    });
    expect(result.success).toBe(false);
  });

  it("allows two agents in the same list to declare different overlays", () => {
    const result = expectParse({
      agents: {
        list: [
          {
            id: "marco",
            mcp: {
              servers: {
                composio: { url: "https://example.com/mcp?user_id=marco" },
              },
            },
          },
          {
            id: "lina",
            mcp: {
              servers: {
                composio: { url: "https://example.com/mcp?user_id=lina" },
              },
            },
          },
        ],
      },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      const list = result.data.agents?.list ?? [];
      expect(list).toHaveLength(2);
      const [m, l] = list;
      expect(
        (m as { mcp?: { servers?: { composio?: { url?: string } } } }).mcp?.servers?.composio?.url,
      ).toBe("https://example.com/mcp?user_id=marco");
      expect(
        (l as { mcp?: { servers?: { composio?: { url?: string } } } }).mcp?.servers?.composio?.url,
      ).toBe("https://example.com/mcp?user_id=lina");
    }
  });

  it("global mcp.servers and per-agent overlay coexist in the same config", () => {
    const result = expectParse({
      mcp: { servers: { shared: { url: "https://shared.example/mcp" } } },
      agents: {
        list: [
          {
            id: "marco",
            mcp: { servers: { composio: { url: "https://example.com/mcp?user_id=marco" } } },
          },
        ],
      },
    });
    expect(result.success).toBe(true);
  });
});
