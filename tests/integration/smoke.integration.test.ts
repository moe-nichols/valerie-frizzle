import { expect, test } from "vitest";
import { ServiceBusAdministrationClient } from "@azure/service-bus";
import { startAdminHttpsProxy, buildAdminConnectionString } from "../../src/main/services/adminHttpsProxy.ts";
import { TEST_MANAGEMENT_PORT, TEST_MESSAGING_CONNECTION_STRING } from "./harness.ts";

test("connects to the real emulator via the admin proxy and lists queues", async () => {
  const proxy = await startAdminHttpsProxy(TEST_MANAGEMENT_PORT);
  try {
    const adminConnectionString = buildAdminConnectionString(TEST_MESSAGING_CONNECTION_STRING, proxy.url);
    const adminClient = new ServiceBusAdministrationClient(adminConnectionString, {
      tlsOptions: { ca: proxy.caCert },
    });

    const queues = [];
    for await (const queue of adminClient.listQueues()) {
      queues.push(queue);
    }
    expect(Array.isArray(queues)).toBe(true);
  } finally {
    await proxy.close();
  }
});
