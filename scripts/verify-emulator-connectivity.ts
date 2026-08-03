#!/usr/bin/env node
// Milestone 0 spike: validates that (a) messaging (ServiceBusClient) works under Node
// against the emulator's AMQP port, and (b) admin CRUD (ServiceBusAdministrationClient)
// works via the local adminHttpsProxy workaround, before any app code is built on top
// of these assumptions.
//
// Background: the JS SDK's ServiceBusAdministrationClient hardcodes `https://` for every
// management request, but the emulator's management API (port 5300) only serves plain
// HTTP — confirmed directly with a raw fetch() test. adminHttpsProxy.ts works around this
// with a local TLS-terminating reverse proxy trusted via the SDK's own `tlsOptions.ca`
// option. See the plan's Context section for the full story.
//
// Prerequisite: the emulator must already be running, e.g.
//   docker compose -f docker/servicebus-emulator/docker-compose.yml up -d

import { ServiceBusAdministrationClient, ServiceBusClient } from '@azure/service-bus'
import {
  buildAdminConnectionString,
  startAdminHttpsProxy
} from '../src/main/services/adminHttpsProxy'

const MESSAGING_CONNECTION_STRING =
  'Endpoint=sb://localhost;SharedAccessKeyName=RootManageSharedAccessKey;SharedAccessKey=SAS_KEY_VALUE;UseDevelopmentEmulator=true;'
const EMULATOR_MANAGEMENT_PORT = 5300
const QUEUE_NAME = `spike-verify-${Date.now()}`

async function main() {
  console.log('[1/6] start local admin HTTPS proxy')
  const proxy = await startAdminHttpsProxy(EMULATOR_MANAGEMENT_PORT)

  const adminConnectionString = buildAdminConnectionString(MESSAGING_CONNECTION_STRING, proxy.url)

  const adminClient = new ServiceBusAdministrationClient(adminConnectionString, {
    tlsOptions: { ca: proxy.caCert }
  })
  const sbClient = new ServiceBusClient(MESSAGING_CONNECTION_STRING)

  try {
    console.log(`[2/6] createQueue(${QUEUE_NAME}) via admin proxy`)
    await adminClient.createQueue(QUEUE_NAME)

    console.log(`[3/6] getQueue(${QUEUE_NAME}) via admin proxy`)
    const queue = await adminClient.getQueue(QUEUE_NAME)
    if (queue.name !== QUEUE_NAME) {
      throw new Error(`getQueue returned unexpected name: ${queue.name}`)
    }

    console.log('[4/6] send message (AMQP, no proxy needed)')
    const sender = sbClient.createSender(QUEUE_NAME)
    await sender.sendMessages({
      body: 'spike-body',
      subject: 'spike-label',
      correlationId: 'spike-correlation-id',
      timeToLive: 60_000
    })
    await sender.close()

    console.log('[5/6] peek message (AMQP, no proxy needed)')
    const receiver = sbClient.createReceiver(QUEUE_NAME)
    const [peeked] = await receiver.peekMessages(1)
    await receiver.close()
    if (peeked?.body !== 'spike-body' || peeked?.subject !== 'spike-label') {
      throw new Error(`peeked message did not round-trip as expected: ${JSON.stringify(peeked)}`)
    }

    console.log(`[6/6] deleteQueue(${QUEUE_NAME}) via admin proxy`)
    await adminClient.deleteQueue(QUEUE_NAME)

    console.log(
      '\nAll checks passed: admin-client CRUD (via adminHttpsProxy) and messaging send/peek both work against the emulator.'
    )
  } finally {
    await sbClient.close()
    await proxy.close()
  }
}

main().catch((err) => {
  console.error('\nSpike FAILED:', err)
  process.exit(1)
})
