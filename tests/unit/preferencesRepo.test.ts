import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { createDatabase } from '../../src/main/services/db/database'
import { PreferencesRepo } from '../../src/main/services/db/preferencesRepo'

let tempDir: string
let db: Database.Database
let repo: PreferencesRepo

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'sb-emulator-manager-test-'))
  db = createDatabase(join(tempDir, 'test.db'))
  repo = new PreferencesRepo(db)
})

afterEach(() => {
  db.close()
  rmSync(tempDir, { recursive: true, force: true })
})

describe('PreferencesRepo', () => {
  test('get returns undefined for an unknown key', () => {
    expect(repo.get('missing')).toBeUndefined()
  })

  test('set/get round-trips a value', () => {
    repo.set('theme', 'light')
    expect(repo.get('theme')).toBe('light')
  })

  test('set overwrites an existing value (upsert)', () => {
    repo.set('theme', 'light')
    repo.set('theme', 'dark')
    expect(repo.get('theme')).toBe('dark')
  })
})
