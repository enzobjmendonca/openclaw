import { Type } from "typebox";
import type { AnyAgentTool } from "./common.js";
import { jsonResult, readStringParam } from "./common.js";

const PassTurnToolSchema = Type.Object({
  reason: Type.Optional(Type.String()),
});

export function createPassTurnTool(opts?: {
  onPass?: (reason: string | undefined) => Promise<void> | void;
}): AnyAgentTool {
  return {
    label: "Pass Turn",
    name: "pass_turn",
    description:
      "End your turn without contributing a message. Use this when you have been given the floor in a multi-party conversation but have nothing meaningful to add: another participant is better placed to respond, the message does not concern you, or the thread is simply waiting for someone else. After calling this tool, produce no additional text.",
    parameters: PassTurnToolSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const reason = readStringParam(params, "reason");
      if (opts?.onPass) {
        await opts.onPass(reason);
      }
      return jsonResult({
        status: "passed",
        ...(reason ? { reason } : {}),
        note: "Turn passed. Do not produce any text after this tool call.",
      });
    },
  };
}
