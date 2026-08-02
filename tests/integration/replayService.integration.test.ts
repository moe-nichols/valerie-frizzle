import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { ServiceBusAdministrationClient, ServiceBusClient } from "@azure/service-bus";
import { startAdminHttpsProxy, buildAdminConnectionString, type AdminHttpsProxy } from "../../src/main/services/adminHttpsProxy.ts";
import { AdminService } from "../../src/main/services/adminService.ts";
import { MessagingService } from "../../src/main/services/messagingService.ts";
import { resubmitMessage } from "../../src/main/services/replayService.ts";
import { purgeEntity } from "../../src/main/services/purgeService.ts";
import { buildDeadLetterQueuePath } from "../../src/shared/domain.ts";
import { TEST_MANAGEMENT_PORT, TEST_MESSAGING_CONNECTION_STRING } from "./harness.ts";

let proxy: AdminHttpsProxy;
let adminService: AdminService;
let sbClient: ServiceBusClient;
let messagingService: MessagingService;
const queueName = `test-replay-queue-${Date.now()}`;
const dlqPath = buildDeadLetterQueuePath(queueName);

beforeAll(async () => {
  proxy = await startAdminHttpsProxy(TEST_MANAGEMENT_PORT);
  const adminConnectionString = buildAdminConnectionString(TEST_MESSAGING_CONNECTION_STRING, proxy.url);
  const adminClient = new ServiceBusAdministrationClient(adminConnectionString, {
    tlsOptions: { ca: proxy.caCert },
  });
  adminService = new AdminService(adminClient);
  await adminService.createQueue({ name: queueName });

  sbClient = new ServiceBusClient(TEST_MESSAGING_CONNECTION_STRING);
  messagingService = new MessagingService(sbClient);
});

afterAll(async () => {
  await messagingService.close();
  await sbClient.close();
  await adminService.deleteQueue(queueName);
  await proxy.close();
});

describe("replayService", () => {
  test("resubmits a dead-lettered message back to its origin queue, regenerating its MessageId", async () => {
    await messagingService.sendMessage(queueName, {
      body: "resubmit me",
      bodyMode: "text",
      correlationId: "corr-replay-1",
      messageId: "original-message-id-1",
    });

    const [received] = await messagingService.receiveMessages(queueName, 1, "peekLock", 5000);
    expect(received).toBeDefined();
    await messagingService.deadLetterMessage(received.handleId as string, "manual", "forced for test");

    const dlqMessagesBeforeResubmit = await messagingService.peekMessages(dlqPath, 10, 0);
    expect(dlqMessagesBeforeResubmit).toHaveLength(1);
    expect(dlqMessagesBeforeResubmit[0].deadLetterReason).toBe("manual");
    expect(dlqMessagesBeforeResubmit[0].body).toBe("resubmit me");

    const [dlqReceived] = await messagingService.receiveMessages(dlqPath, 1, "peekLock", 5000);
    expect(dlqReceived).toBeDefined();

    await resubmitMessage(
      messagingService,
      dlqReceived.handleId as string,
      dlqReceived,
      queueName,
      true
    );

    const dlqMessagesAfterResubmit = await messagingService.peekMessages(dlqPath, 10, 0);
    expect(dlqMessagesAfterResubmit).toHaveLength(0);

    const mainQueueMessages = await messagingService.peekMessages(queueName, 10, 0);
    expect(mainQueueMessages).toHaveLength(1);
    expect(mainQueueMessages[0].body).toBe("resubmit me");
    expect(mainQueueMessages[0].correlationId).toBe("corr-replay-1");
    expect(mainQueueMessages[0].messageId).not.toBe("original-message-id-1");

    // Clean up so it doesn't interfere with the next test.
    const [cleanup] = await messagingService.receiveMessages(queueName, 1, "receiveAndDelete", 5000);
    expect(cleanup).toBeDefined();
  });

  test("keeps the original MessageId when regeneration is off", async () => {
    await messagingService.sendMessage(queueName, {
      body: "resubmit me, keep my id",
      bodyMode: "text",
      messageId: "original-message-id-2",
    });

    const [received] = await messagingService.receiveMessages(queueName, 1, "peekLock", 5000);
    await messagingService.deadLetterMessage(received.handleId as string, "manual", "forced for test");

    const [dlqReceived] = await messagingService.receiveMessages(dlqPath, 1, "peekLock", 5000);
    await resubmitMessage(messagingService, dlqReceived.handleId as string, dlqReceived, queueName, false);

    const mainQueueMessages = await messagingService.peekMessages(queueName, 10, 0);
    const resubmitted = mainQueueMessages.find((m) => m.body === "resubmit me, keep my id");
    expect(resubmitted?.messageId).toBe("original-message-id-2");

    const [cleanup] = await messagingService.receiveMessages(queueName, 1, "receiveAndDelete", 5000);
    expect(cleanup).toBeDefined();
  });

  test("purgeEntity works unchanged against a DLQ path", async () => {
    for (let i = 0; i < 3; i++) {
      await messagingService.sendMessage(queueName, { body: `dlq-purge-${i}`, bodyMode: "text" });
      const [received] = await messagingService.receiveMessages(queueName, 1, "peekLock", 5000);
      await messagingService.deadLetterMessage(received.handleId as string, "manual", "forced for test");
    }

    expect(await messagingService.peekMessages(dlqPath, 10, 0)).toHaveLength(3);

    const totalDeleted = await purgeEntity(messagingService, dlqPath, () => {});
    expect(totalDeleted).toBe(3);

    expect(await messagingService.peekMessages(dlqPath, 10, 0)).toHaveLength(0);
  });
});
