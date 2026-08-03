import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { createDatabase } from '../../src/main/services/db/database'
import { ProfilesRepo } from '../../src/main/services/db/profilesRepo'
import { AppError } from '../../src/shared/errors'

let tempDir: string
let db: Database.Database
let repo: ProfilesRepo

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'sb-emulator-manager-test-'))
  db = createDatabase(join(tempDir, 'test.db'))
  repo = new ProfilesRepo(db)
})

afterEach(() => {
  db.close()
  rmSync(tempDir, { recursive: true, force: true })
})

describe('ProfilesRepo', () => {
  test('create returns a profile with a generated id and timestamps', () => {
    const profile = repo.create({
      name: 'Local dev',
      connectionString: 'Endpoint=sb://localhost;...',
      managementPort: 5300
    })
    expect(profile.id).toBeTruthy()
    expect(profile.name).toBe('Local dev')
    expect(profile.managementPort).toBe(5300)
    expect(profile.createdAt).toBe(profile.updatedAt)
  })

  test('list returns created profiles ordered by name', () => {
    repo.create({ name: 'Zebra', connectionString: 'a', managementPort: 5300 })
    repo.create({ name: 'Alpha', connectionString: 'b', managementPort: 5301 })
    const profiles = repo.list()
    expect(profiles.map((p) => p.name)).toEqual(['Alpha', 'Zebra'])
  })

  test('get returns undefined for an unknown id', () => {
    expect(repo.get('does-not-exist')).toBeUndefined()
  })

  test('update changes only the provided fields and bumps updatedAt', async () => {
    const created = repo.create({ name: 'Original', connectionString: 'a', managementPort: 5300 })
    await new Promise((resolve) => setTimeout(resolve, 2))
    const updated = repo.update(created.id, { name: 'Renamed' })
    expect(updated.name).toBe('Renamed')
    expect(updated.connectionString).toBe('a')
    expect(updated.managementPort).toBe(5300)
    expect(updated.updatedAt).toBeGreaterThan(created.updatedAt)
  })

  test('update throws NOT_FOUND for an unknown id so the renderer sees the right code', () => {
    let thrown: unknown
    try {
      repo.update('does-not-exist', { name: 'x' })
    } catch (err) {
      thrown = err
    }
    expect(thrown).toBeInstanceOf(AppError)
    expect((thrown as AppError).code).toBe('NOT_FOUND')
  })

  test('delete removes the profile', () => {
    const created = repo.create({ name: 'Temp', connectionString: 'a', managementPort: 5300 })
    repo.delete(created.id)
    expect(repo.get(created.id)).toBeUndefined()
  })
})
