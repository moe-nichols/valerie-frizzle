import { describe, expect, test } from "vitest";
import type { ServiceBusClient, ServiceBusReceivedMessage } from "@azure/service-bus";
import { MessagingService } from "../../src/main/services/messagingService.ts";

interface Deferred {
  promise: Promise<void>;
  resolve: () => void;
  reject: (err: unknown) => void;
}

function defer(): Deferred {
  let resolve!: () => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Minimal stand-in for a PeekLock receiver: records close() calls and lets each
 * settlement (completeMessage) be resolved on demand so overlapping settles can be
 * orchestrated deterministically. */
class FakeReceiver {
  closeCount = 0;
  completeDeferreds: Deferred[] = [];

  constructor(
    private messages: ServiceBusReceivedMessage[],
    private receiveError?: Error,
  ) {}

  async receiveMessages(): Promise<ServiceBusReceivedMessage[]> {
    if (this.receiveError) throw this.receiveError;
    return this.messages;
  }

  completeMessage(): Promise<void> {
    const d = defer();
    this.completeDeferreds.push(d);
    return d.promise;
  }

  async close(): Promise<void> {
    this.closeCount++;
  }
}

class FakeClient {
  constructor(private receiver: FakeReceiver) {}
  createReceiver(): FakeReceiver {
    return this.receiver;
  }
}

function makeMessage(sequenceNumber: number): ServiceBusReceivedMessage {
  return { sequenceNumber: { toNumber: () => sequenceNumber } } as unknown as ServiceBusReceivedMessage;
}

function makeService(receiver: FakeReceiver): MessagingService {
  const client = new FakeClient(receiver) as unknown as ServiceBusClient;
  return new MessagingService(client);
}

// Lets pending microtasks (the awaits inside settle) advance before we assert.
const flush = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

describe("MessagingService PeekLock receiver lifecycle", () => {
  test("closes the receiver when a peekLock receive returns no messages (F1)", async () => {
    const receiver = new FakeReceiver([]);
    const service = makeService(receiver);

    const result = await service.receiveMessages("q", 10, "peekLock", 1000);

    expect(result).toEqual([]);
    expect(receiver.closeCount).toBe(1);
  });

  test("closes the receiver and rethrows when a peekLock receive throws (F1)", async () => {
    const boom = new Error("entity not found");
    const receiver = new FakeReceiver([], boom);
    const service = makeService(receiver);

    await expect(service.receiveMessages("q", 10, "peekLock", 1000)).rejects.toThrow("entity not found");
    expect(receiver.closeCount).toBe(1);
  });

  test("concurrent settlements close the shared receiver exactly once, after both resolve (F2)", async () => {
    const receiver = new FakeReceiver([makeMessage(1), makeMessage(2)]);
    const service = makeService(receiver);

    const received = await service.receiveMessages("q", 2, "peekLock", 1000);
    const [a, b] = received;
    expect(a.handleId).toBeDefined();
    expect(b.handleId).toBeDefined();
    expect(receiver.closeCount).toBe(0);

    // Start both settlements; neither completeMessage has resolved yet.
    const settleA = service.completeMessage(a.handleId!);
    const settleB = service.completeMessage(b.handleId!);
    await flush();
    expect(receiver.completeDeferreds).toHaveLength(2);
    // Receiver must NOT be closed while a settlement is still in flight.
    expect(receiver.closeCount).toBe(0);

    receiver.completeDeferreds[0].resolve();
    await settleA;
    // First settle drained one of two handles — still one outstanding, still open.
    expect(receiver.closeCount).toBe(0);

    receiver.completeDeferreds[1].resolve();
    await settleB;
    // Last settle brings the count to zero — now, and only now, it closes. Exactly once.
    expect(receiver.closeCount).toBe(1);
  });

  test("a failed settlement still releases (and closes) the drained receiver (F2)", async () => {
    const receiver = new FakeReceiver([makeMessage(1)]);
    const service = makeService(receiver);

    const [only] = await service.receiveMessages("q", 1, "peekLock", 1000);
    const settle = service.completeMessage(only.handleId!);
    await flush();
    expect(receiver.closeCount).toBe(0);

    receiver.completeDeferreds[0].reject(new Error("lock expired"));
    await expect(settle).rejects.toThrow("lock expired");
    // Even though the action failed, the receiver is drained and must be reclaimed.
    expect(receiver.closeCount).toBe(1);
  });

  test("settling an unknown handle throws (F2 double-settle guard)", async () => {
    const receiver = new FakeReceiver([makeMessage(1)]);
    const service = makeService(receiver);

    const [only] = await service.receiveMessages("q", 1, "peekLock", 1000);
    const settle = service.completeMessage(only.handleId!);
    await flush();
    receiver.completeDeferreds[0].resolve();
    await settle;

    await expect(service.completeMessage(only.handleId!)).rejects.toThrow("no such message handle");
  });
});
