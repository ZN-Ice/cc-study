import { describe, test, expect, beforeEach } from "vitest";
import { Mailbox, type Message } from "../../../src/utils/mailbox.js";

function makeMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    source: "teammate",
    content: "hello",
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

describe("Mailbox — send/receive basics", () => {
  let mailbox: Mailbox;

  beforeEach(() => {
    mailbox = new Mailbox();
  });

  test("starts empty", () => {
    expect(mailbox.length).toBe(0);
    expect(mailbox.revision).toBe(0);
  });

  test("send adds message to queue", () => {
    const msg = makeMessage();
    mailbox.send(msg);
    expect(mailbox.length).toBe(1);
    expect(mailbox.revision).toBe(1);
  });

  test("send increments revision", () => {
    mailbox.send(makeMessage());
    mailbox.send(makeMessage());
    expect(mailbox.revision).toBe(2);
  });

  test("receive returns existing message immediately", async () => {
    const msg = makeMessage({ content: "test-msg" });
    mailbox.send(msg);

    const received = await mailbox.receive();
    expect(received.content).toBe("test-msg");
    expect(mailbox.length).toBe(0);
  });

  test("receive with predicate returns matching message", async () => {
    mailbox.send(makeMessage({ content: "alpha" }));
    mailbox.send(makeMessage({ content: "beta" }));

    const received = await mailbox.receive((m) => m.content === "beta");
    expect(received.content).toBe("beta");
    expect(mailbox.length).toBe(1);
  });
});

describe("Mailbox — poll", () => {
  let mailbox: Mailbox;

  beforeEach(() => {
    mailbox = new Mailbox();
  });

  test("poll returns first matching message", () => {
    mailbox.send(makeMessage({ content: "first" }));
    mailbox.send(makeMessage({ content: "second" }));

    const msg = mailbox.poll((m) => m.content === "second");
    expect(msg?.content).toBe("second");
    expect(mailbox.length).toBe(1);
  });

  test("poll returns undefined when no match", () => {
    mailbox.send(makeMessage({ content: "hello" }));
    const msg = mailbox.poll((m) => m.content === "nonexistent");
    expect(msg).toBeUndefined();
    expect(mailbox.length).toBe(1);
  });

  test("poll with default predicate returns first message", () => {
    mailbox.send(makeMessage({ content: "first" }));
    const msg = mailbox.poll();
    expect(msg?.content).toBe("first");
  });
});

describe("Mailbox — send delivers to matching waiter", () => {
  let mailbox: Mailbox;

  beforeEach(() => {
    mailbox = new Mailbox();
  });

  test("send delivers directly to waiting receiver", async () => {
    const receivePromise = mailbox.receive((m) => m.content === "target");

    mailbox.send(makeMessage({ content: "target" }));

    const received = await receivePromise;
    expect(received.content).toBe("target");
    expect(mailbox.length).toBe(0);
  });

  test("send to non-matching waiter does not deliver", async () => {
    const receivePromise = mailbox.receive((m) => m.content === "target");

    mailbox.send(makeMessage({ content: "other" }));

    expect(mailbox.length).toBe(1);
    // Resolve the pending promise to avoid unhandled rejections
    mailbox.send(makeMessage({ content: "target" }));
    await receivePromise;
  });

  test("first matching waiter gets the message", async () => {
    let firstResolved = false;
    const first = mailbox.receive((m) => m.content === "shared").then((m) => {
      firstResolved = true;
      return m;
    });
    const second = mailbox.receive((m) => m.content === "shared");

    mailbox.send(makeMessage({ content: "shared" }));

    const result = await Promise.race([first, second]);
    expect(result.content).toBe("shared");
    expect(firstResolved).toBe(true);
  });
});

describe("Mailbox — subscribe/unsubscribe", () => {
  let mailbox: Mailbox;

  beforeEach(() => {
    mailbox = new Mailbox();
  });

  test("subscribe fires on send", () => {
    const listener = vi.fn();
    mailbox.subscribe(listener);

    mailbox.send(makeMessage());
    expect(listener).toHaveBeenCalledTimes(1);
  });

  test("unsubscribe stops notifications", () => {
    const listener = vi.fn();
    const unsub = mailbox.subscribe(listener);

    unsub();
    mailbox.send(makeMessage());
    expect(listener).not.toHaveBeenCalled();
  });

  test("subscribe fires on receive (immediate)", async () => {
    mailbox.send(makeMessage());
    const listener = vi.fn();
    mailbox.subscribe(listener);

    await mailbox.receive();
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe("Mailbox — clear", () => {
  test("clear removes all messages", () => {
    const mailbox = new Mailbox();
    mailbox.send(makeMessage());
    mailbox.send(makeMessage());
    expect(mailbox.length).toBe(2);

    mailbox.clear();
    expect(mailbox.length).toBe(0);
  });

  test("clear removes waiters", async () => {
    const mailbox = new Mailbox();
    const receivePromise = mailbox.receive();
    mailbox.clear();

    // After clear, sending should not resolve the old promise
    mailbox.send(makeMessage({ content: "new" }));
    expect(mailbox.length).toBe(1);
  });
});

describe("Mailbox — multiple waiters resolve correctly", () => {
  test("different predicates resolve independently", async () => {
    const mailbox = new Mailbox();
    const waiterA = mailbox.receive((m) => m.content === "a");
    const waiterB = mailbox.receive((m) => m.content === "b");

    mailbox.send(makeMessage({ content: "b" }));
    mailbox.send(makeMessage({ content: "a" }));

    const [resultB, resultA] = await Promise.all([waiterB, waiterA]);
    expect(resultA.content).toBe("a");
    expect(resultB.content).toBe("b");
    expect(mailbox.length).toBe(0);
  });
});
