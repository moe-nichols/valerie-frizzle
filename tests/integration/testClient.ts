import { ServiceBusAdministrationClient, ServiceBusClient } from '@azure/service-bus'
import {
  type AdminHttpsProxy,
  buildAdminConnectionString,
  startAdminHttpsProxy
} from '../../src/main/services/adminHttpsProxy'
import { AdminService } from '../../src/main/services/adminService'
import { MessagingService } from '../../src/main/services/messagingService'
import { TEST_MANAGEMENT_PORT, TEST_MESSAGING_CONNECTION_STRING } from './harness'

// Kept separate from harness.ts so globalSetup (which only starts/stops docker) doesn't
// drag the whole src/main service graph into its import chain.

export interface TestEmulatorClient {
  proxy: AdminHttpsProxy
  adminService: AdminService
  /** The raw SDK admin client behind `adminService`, exposed for the few tests that need to
   * provision entity shapes `AdminService`'s DTOs don't model (e.g. `forwardTo`). */
  adminClient: ServiceBusAdministrationClient
  sbClient: ServiceBusClient
  messagingService: MessagingService
  close(): Promise<void>
}

/** The proxy → admin client → SB client → messaging service wiring every integration
 * suite needs; previously copy-pasted into each file's beforeAll. */
export async function connectToTestEmulator(): Promise<TestEmulatorClient> {
  const proxy = await startAdminHttpsProxy(TEST_MANAGEMENT_PORT)
  const adminConnectionString = buildAdminConnectionString(
    TEST_MESSAGING_CONNECTION_STRING,
    proxy.url
  )
  const adminClient = new ServiceBusAdministrationClient(adminConnectionString, {
    tlsOptions: { ca: proxy.caCert }
  })
  const sbClient = new ServiceBusClient(TEST_MESSAGING_CONNECTION_STRING)
  const messagingService = new MessagingService(sbClient)
  return {
    proxy,
    adminService: new AdminService(adminClient),
    adminClient,
    sbClient,
    messagingService,
    async close() {
      await messagingService.close()
      await sbClient.close()
      await proxy.close()
    }
  }
}
