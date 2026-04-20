import { defineBundledChannelEntry } from "openclaw/plugin-sdk/channel-entry-contract";

export default defineBundledChannelEntry({
  id: "dialetica",
  name: "Dialetica",
  description: "Dialetica internal room channel plugin",
  importMetaUrl: import.meta.url,
  plugin: {
    specifier: "./api.js",
    exportName: "dialeticaPlugin",
  },
  runtime: {
    specifier: "./runtime-api.js",
    exportName: "setDialeticaRuntime",
  },
});
