import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { ServiceBusAdministrationClient, ServiceBusClient } from "@azure/service-bus";
import { startAdminHttpsProxy, buildAdminConnectionString, type AdminHttpsProxy } from "../../src/main/services/adminHttpsProxy.ts";
import { AdminService } from "../../src/main/services/adminService.ts";
import { MessagingService } from "../../src/main/services/messagingService.ts";
import { purgeEntity, type PurgeProgress } from "../../src/main/services/purgeService.ts";
import { TEST_MANAGEMENT_PORT, TEST_MESSAGING_CONNECTION_STRING } from "./harness.ts";

let proxy: AdminHttpsProxy;
let adminService: AdminService;
let sbClient: ServiceBusClient;
let messagingService: MessagingService;
const queueName = `test-purge-queue-${Date.now()}`;

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

describe("purgeService", () => {
  test("drains all messages from a queue and reports progress", async () => {
    const messageCount = 15;
    for (let i = 0; i < messageCount; i++) {
      await messagingService.sendMessage(queueName, { body: `msg-${i}`, bodyMode: "text" });
    }

    expect(await messagingService.peekMessages(queueName, messageCount + 5)).toHaveLength(messageCount);

    const progressEvents: PurgeProgress[] = [];
    const totalDeleted = await purgeEntity(messagingService, queueName, (progress) => {
      progressEvents.push(progress);
    });

    expect(totalDeleted).toBe(messageCount);
    expect(progressEvents.length).toBeGreaterThan(0);
    expect(progressEvents[progressEvents.length - 1]).toEqual({
      deletedCount: messageCount,
      done: true,
      stoppedAtCap: false,
    });

    const remaining = await messagingService.peekMessages(queueName, 10);
    expect(remaining).toHaveLength(0);
  });

  test("purging an already-empty queue completes immediately with zero deletions", async () => {
    const progressEvents: PurgeProgress[] = [];
    const totalDeleted = await purgeEntity(messagingService, queueName, (progress) => {
      progressEvents.push(progress);
    });

    expect(totalDeleted).toBe(0);
    expect(progressEvents).toEqual([{ deletedCount: 0, done: true, stoppedAtCap: false }]);
  });
});
