import { createPluginRuntimeStore } from "openclaw/plugin-sdk/runtime-store";
import type { PluginRuntime } from "./runtime-api.js";

const { setRuntime: setDialeticaRuntime, getRuntime: getDialeticaRuntime } =
  createPluginRuntimeStore<PluginRuntime>("Dialetica runtime not initialized");

export { getDialeticaRuntime, setDialeticaRuntime };
