import type { AckTracker } from "./ack-tracker.js";
import type { AgentEvent } from "./protocol.js";

export type StreamEmitterOptions = {
  ackTracker: AckTracker;
  send: (message: AgentEvent) => Promise<void>;
  sleep: (ms: number) => Promise<void>;
};

export class StreamEmitter {
  constructor(private readonly options: StreamEmitterOptions) {}

  async emit(events: AgentEvent[], delaysMs: number[] = []): Promise<void> {
    for (let index = 0; index < events.length; index += 1) {
      const delay = delaysMs[index] ?? 0;
      if (delay > 0) {
        await this.options.sleep(delay);
      }
      const event = events[index];
      if (event.ack?.mode === "required") {
        const ok = await this.options.ackTracker.send(event, async (message) => {
          await this.options.send(message as AgentEvent);
        });
        if (!ok) {
          return;
        }
        continue;
      }
      await this.options.send(event);
    }
  }
}
