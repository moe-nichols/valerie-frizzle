import { expect, test } from 'vitest'
import { connectToTestEmulator } from './testClient'

test("connects to the real emulator via the admin proxy and lists queues", async () => {
  const client = await connectToTestEmulator();
  try {
    // A meaningful liveness check: create a queue, see it in the listing, delete it —
    // proves the proxy, TLS trust, connection string rewriting, and admin API all work.
    const queueName = `test-smoke-queue-${Date.now()}`;
    await client.adminService.createQueue({ name: queueName });
    const queues = await client.adminService.listQueues();
    expect(queues.map((queue) => queue.name)).toContain(queueName);
    await client.adminService.deleteQueue(queueName);
  } finally {
    await client.close();
  }
});
