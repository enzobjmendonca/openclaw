import { describe, expect, it, vi } from "vitest";
import { createPassTurnTool } from "./pass-turn-tool.js";

describe("pass_turn tool", () => {
  it("records a pass with no reason when called without arguments", async () => {
    const onPass = vi.fn();
    const tool = createPassTurnTool({ onPass });
    const result = await tool.execute("call-1", {});
    expect(result.details).toMatchObject({ status: "passed" });
    expect(result.details).not.toHaveProperty("reason");
    expect(onPass).toHaveBeenCalledOnce();
    expect(onPass).toHaveBeenCalledWith(undefined);
  });

  it("records a pass with a reason when provided", async () => {
    const onPass = vi.fn();
    const tool = createPassTurnTool({ onPass });
    const result = await tool.execute("call-1", { reason: "Bob has the context here" });
    expect(result.details).toMatchObject({
      status: "passed",
      reason: "Bob has the context here",
    });
    expect(onPass).toHaveBeenCalledOnce();
    expect(onPass).toHaveBeenCalledWith("Bob has the context here");
  });

  it("works without an onPass callback", async () => {
    const tool = createPassTurnTool();
    const result = await tool.execute("call-1", {});
    expect(result.details).toMatchObject({ status: "passed" });
  });

  it("includes the end-of-turn note in the tool result", async () => {
    const tool = createPassTurnTool();
    const result = await tool.execute("call-1", {});
    expect(result.details).toMatchObject({
      note: "Turn passed. Do not produce any text after this tool call.",
    });
  });
});
