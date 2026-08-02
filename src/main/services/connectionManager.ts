import { ServiceBusAdministrationClient, ServiceBusClient } from '@azure/service-bus'
import { startAdminHttpsProxy, buildAdminConnectionString, type AdminHttpsProxy } from './adminHttpsProxy'
import { MessagingService } from './messagingService'
import type { ProfilesRepo } from './db/profilesRepo'

interface ActiveConnection {
  adminClient: ServiceBusAdministrationClient
  sbClient: ServiceBusClient
  adminProxy: AdminHttpsProxy
  messagingService: MessagingService
}

export class ConnectionManager {
  private active = new Map<string, ActiveConnection>()
  // In-flight connect attempts, keyed by profile id. Connecting spins up a proxy server
  // and SDK clients across several awaits; without this guard two overlapping connect calls
  // (e.g. a double-clicked "Connect") would each build a full set and the second's would
  // overwrite the first in `active`, orphaning the first's proxy/client forever. Concurrent
  // callers share the same promise instead.
  private connecting = new Map<string, Promise<void>>()

  constructor(private profilesRepo: ProfilesRepo) {}

  isConnected(profileId: string): boolean {
    return this.active.has(profileId)
  }

  async connect(profileId: string): Promise<void> {
    if (this.active.has(profileId)) return

    const inFlight = this.connecting.get(profileId)
    if (inFlight) return inFlight

    const attempt = this.doConnect(profileId).finally(() => {
      this.connecting.delete(profileId)
    })
    this.connecting.set(profileId, attempt)
    return attempt
  }

  private async doConnect(profileId: string): Promise<void> {
    const profile = this.profilesRepo.get(profileId)
    if (!profile) {
      throw new Error(`profile not found: ${profileId}`)
    }

    // Everything the attempt allocates is created inside this try, so any failure (a proxy
    // bind error, client construction, or the liveness check) closes whatever was already
    // opened rather than leaking a listening proxy or an open client.
    let adminProxy: AdminHttpsProxy | undefined
    let sbClient: ServiceBusClient | undefined
    try {
      adminProxy = await startAdminHttpsProxy(profile.managementPort)
      const adminConnectionString = buildAdminConnectionString(profile.connectionString, adminProxy.url)
      const adminClient = new ServiceBusAdministrationClient(adminConnectionString, {
        tlsOptions: { ca: adminProxy.caCert }
      })
      sbClient = new ServiceBusClient(profile.connectionString)

      // Cheap liveness check: pull the first page (even if empty) so a bad connection
      // fails fast here with a clear error, rather than as a confusing timeout later.
      await adminClient.listQueues()[Symbol.asyncIterator]().next()

      const messagingService = new MessagingService(sbClient)
      this.active.set(profileId, { adminClient, sbClient, adminProxy, messagingService })
    } catch (err) {
      await sbClient?.close().catch(() => {})
      await adminProxy?.close().catch(() => {})
      const message = err instanceof Error ? err.message : String(err)
      throw new Error(`could not connect to emulator: ${message}`)
    }
  }

  async disconnect(profileId: string): Promise<void> {
    const connection = this.active.get(profileId)
    if (!connection) return
    this.active.delete(profileId)
    await connection.messagingService.close()
    await connection.sbClient.close()
    await connection.adminProxy.close()
  }

  async disconnectAll(): Promise<void> {
    await Promise.all([...this.active.keys()].map((id) => this.disconnect(id)))
  }

  getAdminClient(profileId: string): ServiceBusAdministrationClient {
    const connection = this.active.get(profileId)
    if (!connection) {
      throw new Error(`profile is not connected: ${profileId}`)
    }
    return connection.adminClient
  }

  getMessagingService(profileId: string): MessagingService {
    const connection = this.active.get(profileId)
    if (!connection) {
      throw new Error(`profile is not connected: ${profileId}`)
    }
    return connection.messagingService
  }
}
