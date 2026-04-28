import { hasControlCommand } from "../auto-reply/command-detection.js";
import type { CommandNormalizeOptions } from "../auto-reply/commands-registry.js";
import {
  createInboundDebouncer,
  resolveInboundDebounceMs,
  resolveInboundMaxWaitMs,
  type InboundDebounceCreateParams,
} from "../auto-reply/inbound-debounce.js";
import type { OpenClawConfig } from "../config/types.js";
import { normalizeOptionalString } from "../shared/string-coerce.js";

export function shouldDebounceTextInbound(params: {
  text: string | null | undefined;
  cfg: OpenClawConfig;
  hasMedia?: boolean;
  commandOptions?: CommandNormalizeOptions;
  allowDebounce?: boolean;
}): boolean {
  if (params.allowDebounce === false) {
    return false;
  }
  if (params.hasMedia) {
    return false;
  }
  const text = normalizeOptionalString(params.text) ?? "";
  if (!text) {
    return false;
  }
  return !hasControlCommand(text, params.cfg, params.commandOptions);
}

export function createChannelInboundDebouncer<T>(
  params: Omit<InboundDebounceCreateParams<T>, "debounceMs" | "maxWaitMs"> & {
    cfg: OpenClawConfig;
    channel: string;
    debounceMsOverride?: number;
    maxWaitMsOverride?: number;
  },
): {
  debounceMs: number;
  maxWaitMs: number;
  debouncer: ReturnType<typeof createInboundDebouncer<T>>;
} {
  const debounceMs = resolveInboundDebounceMs({
    cfg: params.cfg,
    channel: params.channel,
    overrideMs: params.debounceMsOverride,
  });
  const maxWaitMs = resolveInboundMaxWaitMs({
    cfg: params.cfg,
    channel: params.channel,
    overrideMs: params.maxWaitMsOverride,
  });
  const {
    cfg: _cfg,
    channel: _channel,
    debounceMsOverride: _debounceOverride,
    maxWaitMsOverride: _maxWaitOverride,
    ...rest
  } = params;
  const debouncer = createInboundDebouncer<T>({
    debounceMs,
    maxWaitMs,
    ...rest,
  });
  return { debounceMs, maxWaitMs, debouncer };
}
