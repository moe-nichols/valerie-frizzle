import { describe, expect, test } from "vitest";
import { ipcRequestSchemas } from "../../src/shared/ipc-schemas.ts";

describe("ipcRequestSchemas", () => {
  test("rejects a negative maxCount on messages:peek (F4)", () => {
    const result = ipcRequestSchemas["messages:peek"].safeParse({
      profileId: "p",
      entityPath: "q",
      maxCount: -1,
    });
    expect(result.success).toBe(false);
  });

  test("rejects an oversized maxCount on messages:receive (F4)", () => {
    const result = ipcRequestSchemas["messages:receive"].safeParse({
      profileId: "p",
      entityPath: "q",
      maxCount: 99999,
      mode: "peekLock",
      maxWaitTimeMs: 5000,
    });
    expect(result.success).toBe(false);
  });

  test("rejects a non-string entityPath (F4)", () => {
    const result = ipcRequestSchemas["messages:peek"].safeParse({
      profileId: "p",
      entityPath: 42,
      maxCount: 10,
    });
    expect(result.success).toBe(false);
  });

  test("rejects an empty profileId (F4)", () => {
    const result = ipcRequestSchemas["entities:queues:list"].safeParse({ profileId: "" });
    expect(result.success).toBe(false);
  });

  test("rejects an out-of-range management port (F4)", () => {
    const result = ipcRequestSchemas["connections:create"].safeParse({
      name: "dev",
      connectionString: "Endpoint=sb://localhost;",
      managementPort: 70000,
    });
    expect(result.success).toBe(false);
  });

  test("rejects an unknown receive mode (F4)", () => {
    const result = ipcRequestSchemas["messages:receive"].safeParse({
      profileId: "p",
      entityPath: "q",
      maxCount: 10,
      mode: "grabItAll",
      maxWaitTimeMs: 5000,
    });
    expect(result.success).toBe(false);
  });

  test("accepts a valid receive request and strips unknown keys", () => {
    const result = ipcRequestSchemas["messages:receive"].safeParse({
      profileId: "p",
      entityPath: "q",
      maxCount: 20,
      mode: "receiveAndDelete",
      maxWaitTimeMs: 5000,
      injected: "should be stripped",
    });
    expect(result.success).toBe(true);
    expect(result.data).not.toHaveProperty("injected");
  });

  test("rejects a rule with an unknown filter discriminator (F4)", () => {
    const result = ipcRequestSchemas["entities:rules:create"].safeParse({
      profileId: "p",
      input: {
        topicName: "t",
        subscriptionName: "s",
        name: "r",
        filter: { type: "Bogus", sqlExpression: "1=1" },
      },
    });
    expect(result.success).toBe(false);
  });
});
