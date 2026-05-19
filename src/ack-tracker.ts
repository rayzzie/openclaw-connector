import type { Envelope } from "./protocol.js";

export type SendEnvelope = (message: Envelope) => Promise<void>;
export type AckLike = { type?: string; in_reply_to?: string };

export type AckTrackerOptions = {
  ackDeadlineMs: number;
  ackMaxRetries: number;
  onFailure?: (message: Envelope) => void | Promise<void>;
};

type PendingAck = {
  resolve: (value: boolean) => void;
  message: Envelope;
};

export class AckTracker {
  private readonly pending = new Map<string, PendingAck>();
  private closed = false;

  constructor(private readonly options: AckTrackerOptions) {}

  async send(message: Envelope, sendFn: SendEnvelope): Promise<boolean> {
    if ((message.ack?.mode ?? "none") !== "required") {
      if (this.closed) {
        return false;
      }
      await sendFn(message);
      return true;
    }
    if (!message.message_id) {
      throw new Error("ack required message must include message_id");
    }
    if (this.pending.has(message.message_id)) {
      throw new Error(`message is already pending ack: ${message.message_id}`);
    }
    if (this.closed) {
      return false;
    }

    return new Promise<boolean>((resolve) => {
      this.pending.set(message.message_id, { resolve, message });
      void this.sendWithRetries(message, sendFn, resolve);
    });
  }

  handleAck(message: AckLike): boolean {
    if (this.closed || message.type !== "ack" || !message.in_reply_to) {
      return false;
    }
    const pending = this.pending.get(message.in_reply_to);
    if (!pending) {
      return false;
    }
    this.pending.delete(message.in_reply_to);
    pending.resolve(true);
    return true;
  }

  close(_reason: string): void {
    this.closed = true;
    for (const [messageId, pending] of this.pending.entries()) {
      this.pending.delete(messageId);
      pending.resolve(false);
    }
  }

  private async sendWithRetries(message: Envelope, sendFn: SendEnvelope, resolve: (value: boolean) => void): Promise<void> {
    const attempts = this.options.ackMaxRetries + 1;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      if (this.closed || !this.pending.has(message.message_id)) {
        resolve(false);
        return;
      }
      await sendFn(message);
      const acked = await this.waitForAckOrTimeout(message.message_id, this.options.ackDeadlineMs);
      if (acked) {
        return;
      }
    }
    if (this.pending.delete(message.message_id)) {
      await this.options.onFailure?.(message);
      resolve(false);
    }
  }

  private async waitForAckOrTimeout(messageId: string, timeoutMs: number): Promise<boolean> {
    await new Promise<void>((resolve) => setTimeout(resolve, timeoutMs));
    return !this.pending.has(messageId);
  }
}
