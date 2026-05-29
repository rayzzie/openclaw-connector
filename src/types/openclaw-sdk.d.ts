declare module "openclaw/plugin-sdk/core" {
  export interface PluginRuntime {
    channel: {
      reply: {
        dispatchReplyWithBufferedBlockDispatcher(options: {
          ctx: Record<string, unknown>;
          cfg: unknown;
          dispatcherOptions: {
            deliver: (payload: { text?: string }) => Promise<void>;
          };
          signal?: AbortSignal;
        }): Promise<void>;
      };
    };
  }

  export type ChannelId = string;

  export type ChannelMeta = {
    id: ChannelId;
    label: string;
    selectionLabel: string;
    docsPath: string;
    blurb: string;
    order?: number;
    aliases?: readonly string[];
    [key: string]: unknown;
  };

  export type ChannelCapabilities = {
    chatTypes: Array<"dm" | "group" | "thread">;
    [key: string]: unknown;
  };

  export type ChannelConfigAdapter<ResolvedAccount = unknown> = {
    listAccountIds: (cfg: unknown) => string[];
    resolveAccount: (cfg: unknown, accountId?: string | null) => ResolvedAccount;
    isConfigured?: (account: ResolvedAccount, cfg: unknown) => boolean | Promise<boolean>;
    isEnabled?: (account: ResolvedAccount, cfg: unknown) => boolean;
    [key: string]: unknown;
  };

  export type ChannelStatusState = "connecting" | "online" | "degraded" | "error" | "stopped";

  export type ChannelStatus = {
    state: ChannelStatusState;
    detail?: string;
  };

  export type ChannelLogger = {
    debug(message: string, meta?: unknown): void;
    info(message: string, meta?: unknown): void;
    warn(message: string, meta?: unknown): void;
    error(message: string, meta?: unknown): void;
  };

  export type GatewayStartContext<ResolvedAccount = unknown> = {
    account: ResolvedAccount;
    cfg: unknown;
    log: ChannelLogger;
    setStatus: (status: ChannelStatus) => void;
    abortSignal: AbortSignal;
    [key: string]: unknown;
  };

  export type GatewayStopContext<ResolvedAccount = unknown> = {
    account: ResolvedAccount;
    cfg: unknown;
    log: ChannelLogger;
    [key: string]: unknown;
  };

  export type GatewayStopResult = {
    stop: () => void | Promise<void>;
  };

  export type ChannelGatewayAdapter<ResolvedAccount = unknown> = {
    startAccount: (ctx: GatewayStartContext<ResolvedAccount>) => Promise<GatewayStopResult>;
    stopAccount?: (ctx: GatewayStopContext<ResolvedAccount>) => Promise<void>;
  };

  export type ChannelPlugin<ResolvedAccount = unknown> = {
    id: ChannelId;
    meta: ChannelMeta;
    capabilities: ChannelCapabilities;
    setup?: {
      resolveAccount: (cfg: unknown, accountId?: string | null) => ResolvedAccount;
      inspectAccount?: (cfg: unknown, accountId?: string | null) => unknown;
      [key: string]: unknown;
    };
    config: ChannelConfigAdapter<ResolvedAccount>;
    gateway?: ChannelGatewayAdapter<ResolvedAccount>;
    [key: string]: unknown;
  };

  export interface OpenClawPluginApi {
    runtime: PluginRuntime;
    pluginConfig: unknown;
    config: unknown;
    registrationMode?: string;
    logger?: {
      debug(msg: string, meta?: unknown): void;
      info(msg: string, meta?: unknown): void;
      warn(msg: string, meta?: unknown): void;
      error(msg: string, meta?: unknown): void;
    };
    registerChannel(options: { plugin: ChannelPlugin }): void;
  }

  export function definePluginEntry(entry: {
    register(api: OpenClawPluginApi): void | Promise<void>;
    unregister?(): void | Promise<void>;
  }): unknown;

  export function defineChannelPluginEntry<TPlugin>(options: {
    id: string;
    name: string;
    description?: string;
    plugin: TPlugin;
    setRuntime?: (runtime: PluginRuntime) => void;
    registerFull?: (api: OpenClawPluginApi) => void | Promise<void>;
    registerCliMetadata?: (api: OpenClawPluginApi) => void;
  }): unknown;

  export function defineSetupPluginEntry<TPlugin>(plugin: TPlugin): unknown;
}

declare module "openclaw/plugin-sdk/channel-core" {
  import type { ChannelPlugin, OpenClawPluginApi } from "openclaw/plugin-sdk/core";

  export type { ChannelPlugin, OpenClawPluginApi };

  export function defineChannelPluginEntry<TPlugin>(options: {
    id: string;
    name: string;
    description?: string;
    plugin: TPlugin;
    setRuntime?: (runtime: OpenClawPluginApi["runtime"]) => void;
    registerFull?: (api: OpenClawPluginApi) => void | Promise<void>;
    registerCliMetadata?: (api: OpenClawPluginApi) => void;
  }): unknown;

  export function defineSetupPluginEntry<TPlugin>(plugin: TPlugin): unknown;
}
