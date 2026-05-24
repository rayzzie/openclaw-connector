declare module "openclaw/plugin-sdk/core" {
  export interface PluginRuntime {
    channel: {
      reply: {
        dispatchReplyWithBufferedBlockDispatcher(options: {
          ctx: Record<string, unknown>;
          dispatcherOptions: {
            deliver: (payload: { text?: string }) => Promise<void>;
          };
          signal?: AbortSignal;
        }): Promise<void>;
      };
    };
  }

  export interface OpenClawPluginApi {
    runtime: PluginRuntime;
    pluginConfig: unknown;
    logger?: {
      debug(msg: string, meta?: unknown): void;
      info(msg: string, meta?: unknown): void;
      warn(msg: string, meta?: unknown): void;
      error(msg: string, meta?: unknown): void;
    };
  }

  export function definePluginEntry(entry: {
    register(api: OpenClawPluginApi): Promise<void>;
    unregister?(): Promise<void>;
  }): unknown;
}
