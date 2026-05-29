import { defineSetupPluginEntry } from "openclaw/plugin-sdk/core";

import { uniagentgateChannelPlugin } from "./src/channel.js";

export default defineSetupPluginEntry(uniagentgateChannelPlugin);
