import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { ProfilesRepo } from '../../src/main/services/db/profilesRepo'

// Module mocks are hoisted above imports by vitest; the mocked members below are declared
// with `vi.hoisted` so they can be referenced from both the factory and the tests.
const mocks = vi.hoisted(() => {
  return {
    startAdminHttpsProxy: vi.fn(),
    proxyClose: vi.fn(async () => {}),
    ServiceBusClient: vi.fn(),
    sbClientClose: vi.fn(async () => {}),
    ServiceBusAdministrationClient: vi.fn(),
  };
});

vi.mock("../../src/main/services/adminHttpsProxy.ts", () => ({
  startAdminHttpsProxy: mocks.startAdminHttpsProxy,
  buildAdminConnectionString: (cs: string) => cs,
}));

vi.mock("@azure/service-bus", () => ({
  ServiceBusClient: mocks.ServiceBusClient,
  ServiceBusAdministrationClient: mocks.ServiceBusAdministrationClient,
}));

vi.mock("../../src/main/services/messagingService.ts", () => ({
  MessagingService: class {
    async close(): Promise<void> {}
  },
}));

import { ConnectionManager } from '../../src/main/services/connectionManager'

function fakeProfilesRepo(): ProfilesRepo {
  return {
    get: (id: string) => ({
      id,
      name: "test",
      connectionString: "Endpoint=sb://localhost;SharedAccessKey=x;",
      managementPort: 5300,
      createdAt: 0,
      updatedAt: 0,
    }),
  } as unknown as ProfilesRepo;
}

/** An admin client whose listQueues() liveness check succeeds with an empty first page. */
function liveAdminClient(): unknown {
  return {
    listQueues: () => ({
      [Symbol.asyncIterator]: () => ({
        next: async () => ({ done: true, value: undefined }),
      }),
    }),
  };
}

describe("ConnectionManager.connect", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.startAdminHttpsProxy.mockImplementation(async () => ({
      url: "https://127.0.0.1:12345",
      caCert: "cert",
      close: mocks.proxyClose,
    }));
    mocks.ServiceBusClient.mockImplementation(function () {
      return { close: mocks.sbClientClose };
    });
    mocks.ServiceBusAdministrationClient.mockImplementation(function () {
      return liveAdminClient();
    });
  });

  test("concurrent connects for the same profile start the proxy exactly once (F3)", async () => {
    const manager = new ConnectionManager(fakeProfilesRepo());

    await Promise.all([manager.connect("p1"), manager.connect("p1"), manager.connect("p1")]);

    expect(mocks.startAdminHttpsProxy).toHaveBeenCalledTimes(1);
    expect(mocks.ServiceBusClient).toHaveBeenCalledTimes(1);
    expect(manager.isConnected("p1")).toBe(true);
  });

  test("a failure during client construction closes the already-started proxy (F10)", async () => {
    mocks.ServiceBusClient.mockImplementation(function () {
      throw new Error("bad connection string");
    });
    const manager = new ConnectionManager(fakeProfilesRepo());

    await expect(manager.connect("p1")).rejects.toThrow("could not connect to emulator");
    expect(mocks.proxyClose).toHaveBeenCalledTimes(1);
    expect(manager.isConnected("p1")).toBe(false);
  });

  test("a failed connect can be retried afterwards (in-flight guard is cleared)", async () => {
    mocks.ServiceBusAdministrationClient.mockImplementationOnce(function () {
      return {
        listQueues: () => ({
          [Symbol.asyncIterator]: () => ({
            next: async () => {
              throw new Error("emulator down");
            },
          }),
        }),
      };
    });
    const manager = new ConnectionManager(fakeProfilesRepo());

    await expect(manager.connect("p1")).rejects.toThrow("could not connect to emulator");
    expect(manager.isConnected("p1")).toBe(false);

    // Second attempt uses the healthy default mock and should succeed.
    await manager.connect("p1");
    expect(manager.isConnected("p1")).toBe(true);
  });
});
