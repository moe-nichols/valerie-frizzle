import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { createDatabase } from '../../src/main/services/db/database'
import { migrations } from '../../src/main/services/db/migrations'

let tempDir: string

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'sb-emulator-manager-test-'))
})

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true })
})

describe('database migrations', () => {
  test('a fresh database gets every table and records the applied versions', () => {
    const db = createDatabase(join(tempDir, 'test.db'))
    try {
      const tables = (
        db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as {
          name: string
        }[]
      ).map((row) => row.name)
      expect(tables).toEqual(
        expect.arrayContaining(['schema_migrations', 'connection_profiles', 'preferences'])
      )

      const applied = (
        db.prepare('SELECT version FROM schema_migrations ORDER BY version').all() as {
          version: number
        }[]
      ).map((row) => row.version)
      expect(applied).toEqual(migrations.map((migration) => migration.version))
    } finally {
      db.close()
    }
  })

  test('reopening an existing database is idempotent — nothing reapplied, data kept', () => {
    const path = join(tempDir, 'test.db')
    const first = createDatabase(path)
    first.prepare("INSERT INTO preferences (key, value) VALUES ('k', 'v')").run()
    first.close()

    // A reapplied migration would throw here (CREATE TABLE without IF NOT EXISTS).
    const second = createDatabase(path)
    try {
      const row = second.prepare("SELECT value FROM preferences WHERE key = 'k'").get() as {
        value: string
      }
      expect(row.value).toBe('v')
    } finally {
      second.close()
    }
  })
})
