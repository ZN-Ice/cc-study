/**
 * Mailbox - In-memory message queue with event-driven receive.
 *
 * References: free-code/src/utils/mailbox.ts
 *
 * Provides a simple pub/sub message queue used for inter-component
 * communication (not the file-based teammate mailbox — see teammateMailbox.ts).
 */

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────

export type MessageSource = "user" | "teammate" | "system" | "tick" | "task";

export interface Message {
  /** Unique message identifier */
  readonly id: string;
  /** Source type of the message */
  readonly source: MessageSource;
  /** Message content (string or structured data) */
  readonly content: string;
  /** Sender identifier (optional) */
  readonly from?: string;
  /** UI color hint (optional) */
  readonly color?: string;
  /** ISO timestamp of when the message was created */
  readonly timestamp: string;
}

// ──────────────────────────────────────────────
// Waiter and Signal Types
// ──────────────────────────────────────────────

type Waiter = {
  fn: (msg: Message) => boolean;
  resolve: (msg: Message) => void;
};

/**
 * Simple signal implementation for subscription.
 * Avoids external dependencies.
 */
class Signal {
  private listeners: Array<() => void> = [];

  emit(): void {
    for (const listener of this.listeners) {
      try {
        listener();
      } catch {
        // Swallow listener errors to prevent cascading failures
      }
    }
  }

  subscribe(listener: () => void): () => void {
    this.listeners.push(listener);
    return () => {
      const idx = this.listeners.indexOf(listener);
      if (idx !== -1) {
        this.listeners.splice(idx, 1);
      }
    };
  }

  clear(): void {
    this.listeners = [];
  }
}

// ──────────────────────────────────────────────
// Mailbox Class
// ──────────────────────────────────────────────

export class Mailbox {
  private queue: Message[] = [];
  private waiters: Waiter[] = [];
  private changed = new Signal();
  private _revision = 0;

  /** Number of messages currently in the queue */
  get length(): number {
    return this.queue.length;
  }

  /** Monotonic revision counter, increments on each send */
  get revision(): number {
    return this._revision;
  }

  /**
   * Send a message to the mailbox.
   *
   * If there are waiters whose predicate matches this message,
   * it is delivered directly to the first matching waiter.
   * Otherwise, it is appended to the queue.
   */
  send(msg: Message): void {
    this._revision++;
    const idx = this.waiters.findIndex((w) => w.fn(msg));
    if (idx !== -1) {
      const waiter = this.waiters.splice(idx, 1)[0];
      if (waiter) {
        waiter.resolve(msg);
        this.changed.emit();
        return;
      }
    }
    this.queue.push(msg);
    this.changed.emit();
  }

  /**
   * Poll a message that matches the predicate.
   * Returns the message immediately, or undefined if none match.
   */
  poll(fn: (msg: Message) => boolean = () => true): Message | undefined {
    const idx = this.queue.findIndex(fn);
    if (idx === -1) return undefined;
    return this.queue.splice(idx, 1)[0];
  }

  /**
   * Receive a message that matches the predicate.
   * If a matching message is already in the queue, returns it immediately.
   * Otherwise, returns a Promise that resolves when a matching message arrives.
   */
  receive(
    fn: (msg: Message) => boolean = () => true,
  ): Promise<Message> {
    const idx = this.queue.findIndex(fn);
    if (idx !== -1) {
      const msg = this.queue.splice(idx, 1)[0];
      if (msg) {
        this.changed.emit();
        return Promise.resolve(msg);
      }
    }
    return new Promise<Message>((resolve) => {
      this.waiters.push({ fn, resolve });
    });
  }

  /**
   * Subscribe to mailbox changes.
   * Returns an unsubscribe function.
   */
  subscribe(listener: () => void): () => void {
    return this.changed.subscribe(listener);
  }

  /** Clear all messages and waiters */
  clear(): void {
    this.queue = [];
    this.waiters = [];
    this.changed.clear();
  }
}
