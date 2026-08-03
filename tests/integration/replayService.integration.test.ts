import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import type { AdminService } from '../../src/main/services/adminService'
import type { MessagingService } from '../../src/main/services/messagingService'
import { resubmitMessage } from '../../src/main/services/replayService'
import { purgeEntity } from '../../src/main/services/purgeService'
import { buildDeadLetterQueuePath } from '../../src/shared/domain'
import { AppError } from '../../src/shared/errors'
import { connectToTestEmulator, type TestEmulatorClient } from './testClient'

let client: TestEmulatorClient;
let adminService: AdminService;
let messagingService: MessagingService;
const queueName = `test-replay-queue-${Date.now()}`;
const dlqPath = buildDeadLetterQueuePath(queueName);

beforeAll(async () => {
  client = await connectToTestEmulator();
  ({ adminService, messagingService } = client);
  await adminService.createQueue({ name: queueName });
});

afterAll(async () => {
  // Release any open receivers before deleting the entities they point at; close() is
  // idempotent, so client.close() calling it again is harmless.
  await messagingService.close();
  await adminService.deleteQueue(queueName);
  await client.close();
});

/** Sends a message, dead-letters it, and returns its PeekLock handle in the DLQ. */
async function deadLetterOneMessage(body: string): Promise<{ handleId: string; message: Awaited<ReturnType<MessagingService['receiveMessages']>>[number] }> {
  await messagingService.sendMessage(queueName, { body, bodyMode: "text" });
  const [received] = await messagingService.receiveMessages(queueName, 1, "peekLock", 5000);
  expect(received).toBeDefined();
  await messagingService.deadLetterMessage(received.handleId as string, "manual", "forced for test");
  const [dlqReceived] = await messagingService.receiveMessages(dlqPath, 1, "peekLock", 5000);
  expect(dlqReceived).toBeDefined();
  return { handleId: dlqReceived.handleId as string, message: dlqReceived };
}

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

  test("a failed send leaves the DLQ original untouched — the message is never lost", async () => {
    const { handleId, message } = await deadLetterOneMessage("keep me safe");

    // Same real messaging service, but the send to the destination fails.
    const failingSend = Object.create(messagingService) as MessagingService;
    failingSend.sendMessage = async () => {
      throw new Error("destination rejected the send");
    };

    await expect(
      resubmitMessage(failingSend, handleId, message, queueName, true)
    ).rejects.toThrow("destination rejected the send");

    // Nothing reached the main queue, and the original survives in the DLQ — the
    // send-first ordering means a failed resubmit can never lose the message.
    expect(await messagingService.peekMessages(queueName, 10, 0)).toHaveLength(0);
    expect(await messagingService.peekMessages(dlqPath, 10, 0)).toHaveLength(1);

    // Clean up: settle the still-held original.
    await messagingService.completeMessage(handleId);
  });

  test("a failed complete after a successful send raises PARTIAL_SUCCESS", async () => {
    const { handleId, message } = await deadLetterOneMessage("partial success");

    // The send goes through for real; only the DLQ-side complete fails (as it would when
    // the PeekLock expired while the user was reading the message).
    const failingComplete = Object.create(messagingService) as MessagingService;
    failingComplete.completeMessage = async () => {
      throw new Error("lock expired");
    };

    const error = await resubmitMessage(failingComplete, handleId, message, queueName, true).catch(
      (err) => err
    );
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe("PARTIAL_SUCCESS");

    // The copy really did land at the destination.
    const mainQueueMessages = await messagingService.peekMessages(queueName, 10, 0);
    expect(mainQueueMessages.map((m) => m.body)).toContain("partial success");

    // Clean up: settle the original for real and drain the delivered copy.
    await messagingService.completeMessage(handleId);
    const cleanup = await messagingService.receiveMessages(queueName, 10, "receiveAndDelete", 5000);
    expect(cleanup.length).toBeGreaterThanOrEqual(1);
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
