import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type Database from 'better-sqlite3'
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest'
import { ConnectionManager } from '../../src/main/services/connectionManager'
import { createDatabase } from '../../src/main/services/db/database'
import { ProfilesRepo } from '../../src/main/services/db/profilesRepo'
import { TEST_MANAGEMENT_PORT, TEST_MESSAGING_CONNECTION_STRING } from './harness'

let tempDir: string
let db: Database.Database
let profilesRepo: ProfilesRepo
let connectionManager: ConnectionManager

beforeAll(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'sb-emulator-manager-integration-'))
  db = createDatabase(join(tempDir, 'test.db'))
  profilesRepo = new ProfilesRepo(db)
  connectionManager = new ConnectionManager(profilesRepo)
})

afterEach(async () => {
  await connectionManager.disconnectAll()
})

afterAll(() => {
  db.close()
  rmSync(tempDir, { recursive: true, force: true })
})

describe('ConnectionManager', () => {
  test('connect/disconnect against a real emulator profile', async () => {
    const profile = profilesRepo.create({
      name: 'test profile',
      connectionString: TEST_MESSAGING_CONNECTION_STRING,
      managementPort: TEST_MANAGEMENT_PORT
    })

    expect(connectionManager.isConnected(profile.id)).toBe(false)

    await connectionManager.connect(profile.id)
    expect(connectionManager.isConnected(profile.id)).toBe(true)

    // connecting again while already connected is a no-op, not an error
    await connectionManager.connect(profile.id)
    expect(connectionManager.isConnected(profile.id)).toBe(true)

    await connectionManager.disconnect(profile.id)
    expect(connectionManager.isConnected(profile.id)).toBe(false)
  })

  test('disconnect issued during an in-flight connect still tears the connection down', async () => {
    // Real-timing counterpart of the unit-level race test: connect spans several awaits
    // (proxy bind, client construction, liveness check), so an immediate disconnect races
    // it authentically here.
    const profile = profilesRepo.create({
      name: 'race profile',
      connectionString: TEST_MESSAGING_CONNECTION_STRING,
      managementPort: TEST_MANAGEMENT_PORT
    })

    const connecting = connectionManager.connect(profile.id)
    const disconnecting = connectionManager.disconnect(profile.id)
    await Promise.all([connecting, disconnecting])

    expect(connectionManager.isConnected(profile.id)).toBe(false)
  })

  test('connect throws a clear error for an unreachable management port', async () => {
    const profile = profilesRepo.create({
      name: 'unreachable profile',
      connectionString: TEST_MESSAGING_CONNECTION_STRING,
      managementPort: 9999
    })

    await expect(connectionManager.connect(profile.id)).rejects.toThrow(/could not connect/)
    expect(connectionManager.isConnected(profile.id)).toBe(false)
  })

  test('connect throws for a profile id that does not exist', async () => {
    await expect(connectionManager.connect('does-not-exist')).rejects.toThrow(/not found/)
  })

  test('testConnection resolves for a reachable emulator without persisting a connection', async () => {
    await expect(
      connectionManager.testConnection(TEST_MESSAGING_CONNECTION_STRING, TEST_MANAGEMENT_PORT)
    ).resolves.toBeUndefined()
    // It must not join `active` — it's a throwaway probe, not a real connection.
    expect([
      ...(connectionManager as unknown as { active: Map<string, unknown> }).active.keys()
    ]).toHaveLength(0)
  })

  test('testConnection throws a clear error for an unreachable management port', async () => {
    await expect(
      connectionManager.testConnection(TEST_MESSAGING_CONNECTION_STRING, 9999)
    ).rejects.toThrow(/could not connect/)
  })
})
