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

/**
 * Environment-variable fallbacks for the default Dialetica account.
 *
 * Rationale: hosts that provision OpenClaw dynamically (e.g. Dialetica's
 * per-org runtime manager) want to avoid writing the runtime's config file,
 * because that same file is where OpenClaw persists hot-reloaded state such
 * as the agents list. Writing it from outside creates a state-clobbering
 * race. Allowing the channel's bootstrap knobs to flow through env vars
 * removes the need to touch the file.
 *
 * Env vars apply only when the corresponding config key is absent/empty AND
 * the request is for the default account. Multi-account deployments should
 * continue to use config-file entries per account.
 */
const ENV_PREFIX = "DIALETICA_";

function envFallback(name: string): string | undefined {
  if (typeof process === "undefined" || !process.env) return undefined;
  const value = process.env[`${ENV_PREFIX}${name}`];
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed === "" ? undefined : trimmed;
}

function envBoolean(name: string): boolean | undefined {
  const raw = envFallback(name);
  if (raw === undefined) return undefined;
  const lowered = raw.toLowerCase();
  if (lowered === "1" || lowered === "true" || lowered === "yes") return true;
  if (lowered === "0" || lowered === "false" || lowered === "no") return false;
  return undefined;
}

export function resolveDialeticaAccount(params: {
  cfg: CoreConfig;
  accountId?: string | null;
}): ResolvedDialeticaAccount {
  const accountId = normalizeAccountId(params.accountId);
  const merged = resolveMergedDialeticaAccountConfig(params.cfg, accountId);
  const isDefaultAccount = accountId === DEFAULT_ACCOUNT_ID;

  const envBaseUrl = isDefaultAccount ? envFallback("BASE_URL") : undefined;
  const envApiToken = isDefaultAccount ? envFallback("API_TOKEN") : undefined;
  const envBotUserId = isDefaultAccount ? envFallback("BOT_USER_ID") : undefined;
  const envBotDisplayName = isDefaultAccount
    ? envFallback("BOT_DISPLAY_NAME")
    : undefined;
  const envEnabled = isDefaultAccount ? envBoolean("CHANNEL_ENABLED") : undefined;

  const baseEnabled = params.cfg.channels?.dialetica?.enabled !== false;
  const enabledFromConfig = baseEnabled && merged.enabled !== false;
  const enabled = envEnabled ?? enabledFromConfig;

  const baseUrl = (merged.baseUrl?.trim() || envBaseUrl) ?? "";
  const apiToken = merged.apiToken?.trim() || envApiToken || undefined;
  const botUserId = merged.botUserId?.trim() || envBotUserId || "openclaw";
  const botDisplayName = merged.botDisplayName?.trim() || envBotDisplayName || "OpenClaw";

  // Diagnostic so ops can see whether env vars reached the process and which
  // knob produced the final value. Only the default account logs; other
  // accounts are expected to be configured via config file, so spamming them
  // on every resolveDialeticaAccount call is noise.
  if (isDefaultAccount) {
    console.info("[dialetica] account resolved", {
      accountId,
      enabled,
      configured: Boolean(baseUrl),
      baseUrl: baseUrl || "<empty>",
      baseUrlSource: merged.baseUrl?.trim() ? "config" : envBaseUrl ? "env" : "none",
      apiTokenSource: merged.apiToken?.trim() ? "config" : envApiToken ? "env" : "none",
      hasApiToken: Boolean(apiToken),
      envSeesBaseUrl: Boolean(envFallback("BASE_URL")),
      envSeesApiToken: Boolean(envFallback("API_TOKEN")),
      envSeesChannelEnabled: envFallback("CHANNEL_ENABLED") ?? "<unset>",
    });
  }

  return {
    accountId,
    enabled,
    configured: Boolean(baseUrl),
    name: normalizeOptionalString(merged.name),
    baseUrl,
    apiToken,
    botUserId,
    botDisplayName,
    config: {
      ...merged,
      allowFrom: merged.allowFrom ?? ["*"],
    },
  };
}
