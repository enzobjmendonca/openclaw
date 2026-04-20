import { createAccountListHelpers } from "openclaw/plugin-sdk/account-helpers";
import { DEFAULT_ACCOUNT_ID, normalizeAccountId } from "openclaw/plugin-sdk/account-id";
import { resolveMergedAccountConfig } from "openclaw/plugin-sdk/account-resolution";
import { normalizeOptionalString } from "openclaw/plugin-sdk/text-runtime";
import type { CoreConfig, DialeticaAccountConfig, ResolvedDialeticaAccount } from "./types.js";

const {
  listAccountIds: listDialeticaAccountIds,
  resolveDefaultAccountId: resolveDefaultDialeticaAccountId,
} = createAccountListHelpers("dialetica", { normalizeAccountId });

export { DEFAULT_ACCOUNT_ID, listDialeticaAccountIds, resolveDefaultDialeticaAccountId };

function resolveMergedDialeticaAccountConfig(
  cfg: CoreConfig,
  accountId: string,
): DialeticaAccountConfig {
  return resolveMergedAccountConfig<DialeticaAccountConfig>({
    channelConfig: cfg.channels?.dialetica as DialeticaAccountConfig | undefined,
    accounts: cfg.channels?.dialetica?.accounts,
    accountId,
    omitKeys: ["defaultAccount"],
    normalizeAccountId,
  });
}

export function resolveDialeticaAccount(params: {
  cfg: CoreConfig;
  accountId?: string | null;
}): ResolvedDialeticaAccount {
  const accountId = normalizeAccountId(params.accountId);
  const merged = resolveMergedDialeticaAccountConfig(params.cfg, accountId);
  const baseEnabled = params.cfg.channels?.dialetica?.enabled !== false;
  const enabled = baseEnabled && merged.enabled !== false;
  const baseUrl = merged.baseUrl?.trim() ?? "";
  return {
    accountId,
    enabled,
    configured: Boolean(baseUrl),
    name: normalizeOptionalString(merged.name),
    baseUrl,
    apiToken: merged.apiToken?.trim() || undefined,
    runtimeId: merged.runtimeId?.trim() || "default",
    botUserId: merged.botUserId?.trim() || "openclaw",
    botDisplayName: merged.botDisplayName?.trim() || "OpenClaw",
    config: {
      ...merged,
      allowFrom: merged.allowFrom ?? ["*"],
    },
  };
}
