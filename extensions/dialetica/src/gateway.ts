import { subscribeDialeticaEventsWs } from "./client.js";
import { handleDialeticaInbound } from "./inbound.js";
import type { ChannelGatewayContext } from "./runtime-api.js";
import type { CoreConfig, ResolvedDialeticaAccount } from "./types.js";

export async function startDialeticaGatewayAccount(
  channelId: string,
  channelLabel: string,
  ctx: ChannelGatewayContext<ResolvedDialeticaAccount>,
) {
  const account = ctx.account;
  if (!account.configured) {
    throw new Error(`Dialetica is not configured for account "${account.accountId}"`);
  }
  ctx.setStatus({
    accountId: account.accountId,
    running: true,
    configured: true,
    enabled: account.enabled,
    baseUrl: account.baseUrl,
  });
  let cursor = Date.now() - 1_000;
  console.info("[dialetica] gateway account started", {
    accountId: account.accountId,
    initialCursor: cursor,
    baseUrl: account.baseUrl,
  });
  try {
    while (!ctx.abortSignal.aborted) {
      cursor = await subscribeDialeticaEventsWs({
        account,
        cursor,
        signal: ctx.abortSignal,
        onEvents: async (result) => {
          for (const event of result.events) {
            if (event.kind !== "message") {
              continue;
            }
            await handleDialeticaInbound({
              channelId,
              channelLabel,
              account,
              config: ctx.cfg as CoreConfig,
              message: event.message,
            });
          }
        },
      });
      if (!ctx.abortSignal.aborted) {
        await new Promise((resolve) => setTimeout(resolve, 1_000));
      }
    }
  } catch (error) {
    if (!(error instanceof Error) || error.name !== "AbortError") {
      throw error;
    }
  }
  ctx.setStatus({
    accountId: account.accountId,
    running: false,
  });
}
