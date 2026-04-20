import { defineSetupPluginEntry } from "openclaw/plugin-sdk/channel-core";
import { dialeticaPlugin } from "./src/channel.js";

export default defineSetupPluginEntry(dialeticaPlugin);
