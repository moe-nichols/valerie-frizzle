import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { ServiceBusAdministrationClient } from "@azure/service-bus";
import { startAdminHttpsProxy, buildAdminConnectionString, type AdminHttpsProxy } from "../../src/main/services/adminHttpsProxy.ts";
import { AdminService } from "../../src/main/services/adminService.ts";
import { TEST_MANAGEMENT_PORT, TEST_MESSAGING_CONNECTION_STRING } from "./harness.ts";

// Note: `maxSizeInMegabytes` is deliberately not asserted on anywhere in this file —
// confirmed via direct investigation that the emulator ignores it at both create and
// update time (always reports 100 regardless of the requested value, even with valid
// Azure tier sizes like 1024/2048). `maxDeliveryCount` and `defaultMessageTimeToLive`
// were both confirmed to apply correctly, so those are used instead to verify real
// create/update semantics.

let proxy: AdminHttpsProxy;
let adminService: AdminService;

beforeAll(async () => {
  proxy = await startAdminHttpsProxy(TEST_MANAGEMENT_PORT);
  const adminConnectionString = buildAdminConnectionString(TEST_MESSAGING_CONNECTION_STRING, proxy.url);
  const client = new ServiceBusAdministrationClient(adminConnectionString, {
    tlsOptions: { ca: proxy.caCert },
  });
  adminService = new AdminService(client);
});

afterAll(async () => {
  await proxy.close();
});

describe("AdminService — queues", () => {
  const queueName = `test-queue-${Date.now()}`;

  test("create returns the created queue with the requested options applied", async () => {
    const queue = await adminService.createQueue({ name: queueName, maxDeliveryCount: 7 });
    expect(queue.name).toBe(queueName);
    expect(queue.maxDeliveryCount).toBe(7);
    expect(queue.status).toBe("Active");
  });

  test("get returns the same queue", async () => {
    const queue = await adminService.getQueue(queueName);
    expect(queue.name).toBe(queueName);
  });

  test("list includes the created queue", async () => {
    const queues = await adminService.listQueues();
    expect(queues.map((q) => q.name)).toContain(queueName);
  });

  test("update changes only the requested field — despite the emulator's malformed update response", async () => {
    // This exercises adminService's runUpdateWithEmulatorParseWorkaround path: the SDK
    // throws a client-side PARSE_ERROR on this call even though the update succeeds
    // server-side, and adminService must recover by re-fetching rather than surfacing
    // the parse error as a failure.
    const updated = await adminService.updateQueue(queueName, { maxDeliveryCount: 9 });
    expect(updated.maxDeliveryCount).toBe(9);
    expect(updated.name).toBe(queueName);
  });

  test("delete removes the queue", async () => {
    await adminService.deleteQueue(queueName);
    const queues = await adminService.listQueues();
    expect(queues.map((q) => q.name)).not.toContain(queueName);
  });
});

describe("AdminService — topics and subscriptions", () => {
  const topicName = `test-topic-${Date.now()}`;
  const subscriptionName = "test-subscription";

  afterAll(async () => {
    // topic deletion cascades its subscriptions; clean up defensively either way
    const topics = await adminService.listTopics();
    if (topics.some((t) => t.name === topicName)) {
      await adminService.deleteTopic(topicName);
    }
  });

  test("create/get/list a topic", async () => {
    const created = await adminService.createTopic({ name: topicName, defaultMessageTimeToLive: "PT30M" });
    expect(created.name).toBe(topicName);

    const fetched = await adminService.getTopic(topicName);
    expect(fetched.defaultMessageTimeToLive).toBe("PT30M");

    const topics = await adminService.listTopics();
    expect(topics.map((t) => t.name)).toContain(topicName);
  });

  test("update a topic — despite the emulator's malformed update response", async () => {
    const updated = await adminService.updateTopic(topicName, { defaultMessageTimeToLive: "PT45M" });
    expect(updated.defaultMessageTimeToLive).toBe("PT45M");
  });

  test("create/get/list a subscription under the topic", async () => {
    const created = await adminService.createSubscription({
      topicName,
      subscriptionName,
      maxDeliveryCount: 5,
    });
    expect(created.subscriptionName).toBe(subscriptionName);
    expect(created.topicName).toBe(topicName);
    expect(created.maxDeliveryCount).toBe(5);

    const fetched = await adminService.getSubscription(topicName, subscriptionName);
    expect(fetched.subscriptionName).toBe(subscriptionName);

    const subscriptions = await adminService.listSubscriptions(topicName);
    expect(subscriptions.map((s) => s.subscriptionName)).toContain(subscriptionName);
  });

  test("update a subscription", async () => {
    const updated = await adminService.updateSubscription(topicName, subscriptionName, {
      maxDeliveryCount: 8,
    });
    expect(updated.maxDeliveryCount).toBe(8);
  });

  test("delete a subscription", async () => {
    await adminService.deleteSubscription(topicName, subscriptionName);
    const subscriptions = await adminService.listSubscriptions(topicName);
    expect(subscriptions.map((s) => s.subscriptionName)).not.toContain(subscriptionName);
  });

  test("delete the topic", async () => {
    await adminService.deleteTopic(topicName);
    const topics = await adminService.listTopics();
    expect(topics.map((t) => t.name)).not.toContain(topicName);
  });
});

describe("AdminService — rules", () => {
  const topicName = `test-rules-topic-${Date.now()}`;
  const subscriptionName = "test-rules-subscription";

  beforeAll(async () => {
    await adminService.createTopic({ name: topicName });
    await adminService.createSubscription({ topicName, subscriptionName });
  });

  afterAll(async () => {
    await adminService.deleteTopic(topicName);
  });

  test("a new subscription already has the auto-created $Default rule", async () => {
    const rules = await adminService.listRules(topicName, subscriptionName);
    expect(rules.map((r) => r.name)).toContain("$Default");
  });

  test("create a SQL rule", async () => {
    const rule = await adminService.createRule({
      topicName,
      subscriptionName,
      name: "sql-rule",
      filter: { type: "Sql", sqlExpression: "sys.Label = 'urgent'" },
    });
    expect(rule.name).toBe("sql-rule");
    expect(rule.filter).toEqual({ type: "Sql", sqlExpression: "sys.Label = 'urgent'" });

    const rules = await adminService.listRules(topicName, subscriptionName);
    expect(rules.map((r) => r.name)).toContain("sql-rule");
  });

  test("create a correlation rule", async () => {
    const rule = await adminService.createRule({
      topicName,
      subscriptionName,
      name: "correlation-rule",
      filter: { type: "Correlation", correlationId: "abc-123", subject: "orders" },
    });
    expect(rule.name).toBe("correlation-rule");
    expect(rule.filter).toMatchObject({
      type: "Correlation",
      correlationId: "abc-123",
      subject: "orders",
    });

    const rules = await adminService.listRules(topicName, subscriptionName);
    expect(rules.map((r) => r.name)).toContain("correlation-rule");
  });

  test("list reflects all rules created so far", async () => {
    const rules = await adminService.listRules(topicName, subscriptionName);
    expect(rules.map((r) => r.name).sort()).toEqual(
      ["$Default", "correlation-rule", "sql-rule"].sort()
    );
  });

  test("delete removes a rule", async () => {
    await adminService.deleteRule(topicName, subscriptionName, "sql-rule");
    const rules = await adminService.listRules(topicName, subscriptionName);
    expect(rules.map((r) => r.name)).not.toContain("sql-rule");
    expect(rules.map((r) => r.name)).toContain("correlation-rule");
  });
});
