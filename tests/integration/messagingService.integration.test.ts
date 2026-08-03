import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { ServiceBusAdministrationClient, ServiceBusClient } from '@azure/service-bus'
import { startAdminHttpsProxy, buildAdminConnectionString, type AdminHttpsProxy } from '../../src/main/services/adminHttpsProxy'
import { AdminService } from '../../src/main/services/adminService'
import { MessagingService } from '../../src/main/services/messagingService'
import { TEST_MANAGEMENT_PORT, TEST_MESSAGING_CONNECTION_STRING } from './harness'

let proxy: AdminHttpsProxy;
let adminService: AdminService;
let sbClient: ServiceBusClient;
let messagingService: MessagingService;
const queueName = `test-messages-queue-${Date.now()}`;
const topicName = `test-messages-topic-${Date.now()}`;
const subscriptionName = "test-messages-sub";

beforeAll(async () => {
  proxy = await startAdminHttpsProxy(TEST_MANAGEMENT_PORT);
  const adminConnectionString = buildAdminConnectionString(TEST_MESSAGING_CONNECTION_STRING, proxy.url);
  const adminClient = new ServiceBusAdministrationClient(adminConnectionString, {
    tlsOptions: { ca: proxy.caCert },
  });
  adminService = new AdminService(adminClient);
  await adminService.createQueue({ name: queueName });
  await adminService.createTopic({ name: topicName });
  await adminService.createSubscription({ topicName, subscriptionName });

  sbClient = new ServiceBusClient(TEST_MESSAGING_CONNECTION_STRING);
  messagingService = new MessagingService(sbClient);
});

afterAll(async () => {
  await messagingService.close();
  await sbClient.close();
  await adminService.deleteQueue(queueName);
  await adminService.deleteTopic(topicName);
  await proxy.close();
});

describe("MessagingService — send/peek round-trip", () => {
  test("text body with broker properties round-trips correctly via peek", async () => {
    await messagingService.sendMessage(queueName, {
      body: "hello world",
      bodyMode: "text",
      contentType: "text/plain",
      subject: "greeting",
      correlationId: "corr-text-1",
      messageId: "msg-text-1",
      applicationProperties: { priority: "high", retries: 3, urgent: true },
    });

    const messages = await messagingService.peekMessages(queueName, 20);
    const found = messages.find((m) => m.messageId === "msg-text-1");
    expect(found).toBeDefined();
    expect(found?.body).toBe("hello world");
    expect(found?.contentType).toBe("text/plain");
    expect(found?.subject).toBe("greeting");
    expect(found?.correlationId).toBe("corr-text-1");
    expect(found?.applicationProperties).toEqual({ priority: "high", retries: 3, urgent: true });
  });

  test("JSON body round-trips as the raw string (Service Bus never parses bodies)", async () => {
    const jsonBody = JSON.stringify({ foo: "bar", count: 2 });
    await messagingService.sendMessage(queueName, {
      body: jsonBody,
      bodyMode: "json",
      contentType: "application/json",
      messageId: "msg-json-1",
    });

    const messages = await messagingService.peekMessages(queueName, 20);
    const found = messages.find((m) => m.messageId === "msg-json-1");
    expect(found).toBeDefined();
    expect(found?.body).toBe(jsonBody);
    expect(JSON.parse(found?.body ?? "")).toEqual({ foo: "bar", count: 2 });
    expect(found?.contentType).toBe("application/json");
  });

  test("XML body round-trips correctly", async () => {
    const xmlBody = "<order><id>42</id></order>";
    await messagingService.sendMessage(queueName, {
      body: xmlBody,
      bodyMode: "xml",
      contentType: "application/xml",
      messageId: "msg-xml-1",
    });

    const messages = await messagingService.peekMessages(queueName, 20);
    const found = messages.find((m) => m.messageId === "msg-xml-1");
    expect(found).toBeDefined();
    expect(found?.body).toBe(xmlBody);
    expect(found?.contentType).toBe("application/xml");
  });

  test("blank messageId is auto-generated", async () => {
    await messagingService.sendMessage(queueName, {
      body: "no explicit id",
      bodyMode: "text",
    });
    const messages = await messagingService.peekMessages(queueName, 20);
    const found = messages.find((m) => m.body === "no explicit id");
    expect(found).toBeDefined();
    expect(found?.messageId).toBeTruthy();
  });
});

describe("MessagingService — PeekLock vs ReceiveAndDelete behave differently", () => {
  test("receiveAndDelete removes the message immediately", async () => {
    await messagingService.sendMessage(queueName, {
      body: "delete me",
      bodyMode: "text",
      messageId: "msg-rad-1",
    });

    // Peek is non-destructive, so earlier tests in this file may have left messages
    // sitting in the queue — receive is FIFO, so a generous maxCount + lookup-by-id is
    // used throughout this describe block rather than assuming array position/length.
    // This first receiveAndDelete call also drains any such leftovers, leaving the
    // queue empty for the tests that follow.
    const received = await messagingService.receiveMessages(queueName, 50, "receiveAndDelete", 5000);
    const found = received.find((m) => m.messageId === "msg-rad-1");
    expect(found).toBeDefined();
    expect(found?.handleId).toBeUndefined();

    // Message is truly gone — a second receive attempt finds nothing.
    const secondAttempt = await messagingService.receiveMessages(queueName, 5, "receiveAndDelete", 2000);
    expect(secondAttempt.find((m) => m.messageId === "msg-rad-1")).toBeUndefined();
  });

  test("peekLock message survives abandon and can be re-received", async () => {
    await messagingService.sendMessage(queueName, {
      body: "lock me",
      bodyMode: "text",
      messageId: "msg-lock-1",
    });

    const received = await messagingService.receiveMessages(queueName, 10, "peekLock", 5000);
    const message = received.find((m) => m.messageId === "msg-lock-1");
    expect(message).toBeDefined();
    expect(message?.handleId).toBeTruthy();

    // Abandon releases the lock without deleting the message — it becomes available again.
    await messagingService.abandonMessage(message?.handleId as string);
    // Settle any other messages this receive call happened to lock, so they don't sit
    // locked until their lock duration expires.
    for (const other of received) {
      if (other.messageId !== "msg-lock-1" && other.handleId) {
        await messagingService.completeMessage(other.handleId);
      }
    }

    const receivedAgain = await messagingService.receiveMessages(queueName, 10, "peekLock", 5000);
    const stillThere = receivedAgain.find((m) => m.messageId === "msg-lock-1");
    expect(stillThere).toBeDefined();

    // Now actually complete it so it doesn't leak into other tests/purges.
    await messagingService.completeMessage(stillThere?.handleId as string);
    for (const other of receivedAgain) {
      if (other.messageId !== "msg-lock-1" && other.handleId) {
        await messagingService.completeMessage(other.handleId);
      }
    }
  });

  test("peekLock message is gone for good after complete", async () => {
    await messagingService.sendMessage(queueName, {
      body: "complete me",
      bodyMode: "text",
      messageId: "msg-complete-1",
    });

    const received = await messagingService.receiveMessages(queueName, 10, "peekLock", 5000);
    const message = received.find((m) => m.messageId === "msg-complete-1");
    expect(message).toBeDefined();
    await messagingService.completeMessage(message?.handleId as string);
    for (const other of received) {
      if (other.messageId !== "msg-complete-1" && other.handleId) {
        await messagingService.completeMessage(other.handleId);
      }
    }

    const afterComplete = await messagingService.receiveMessages(queueName, 10, "peekLock", 2000);
    expect(afterComplete.find((m) => m.messageId === "msg-complete-1")).toBeUndefined();
  });
});

describe("MessagingService — peekSubscriptionMessages", () => {
  test("a message sent to a topic is visible via its subscription's peek", async () => {
    await messagingService.sendMessage(topicName, {
      body: "fan-out me",
      bodyMode: "text",
      messageId: "msg-sub-peek-1",
    });

    const messages = await messagingService.peekSubscriptionMessages(topicName, subscriptionName, 20, 0);
    const found = messages.find((m) => m.messageId === "msg-sub-peek-1");
    expect(found).toBeDefined();
    expect(found?.body).toBe("fan-out me");
  });
});

describe("MessagingService — count methods", () => {
  const countQueueName = `test-count-queue-${Date.now()}`;

  beforeAll(async () => {
    await adminService.createQueue({ name: countQueueName });
    for (let i = 0; i < 3; i++) {
      await messagingService.sendMessage(countQueueName, {
        body: `count-${i}`,
        bodyMode: "text",
        messageId: `msg-count-${i}`,
      });
    }
  });

  afterAll(async () => {
    await adminService.deleteQueue(countQueueName);
  });

  test("countMessages returns the number of messages, capped at maxCount", async () => {
    expect(await messagingService.countMessages(countQueueName, 250, 0)).toBe(3);
    // Capped: only maxCount is peeked, so the result is a lower bound.
    expect(await messagingService.countMessages(countQueueName, 2, 0)).toBe(2);
  });

  test("countSubscriptionMessages counts messages fanned out to a subscription", async () => {
    await messagingService.sendMessage(topicName, {
      body: "count me",
      bodyMode: "text",
      messageId: "msg-sub-count-1",
    });

    const count = await messagingService.countSubscriptionMessages(
      topicName,
      subscriptionName,
      250,
      0,
    );
    expect(count).toBeGreaterThanOrEqual(1);
  });
});
