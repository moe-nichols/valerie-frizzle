import { randomUUID } from 'node:crypto'
import type { ConnectionProfile } from '@shared/domain'
import { AppError } from '@shared/errors'
import type { Database } from 'better-sqlite3'

interface ProfileRow {
  id: string
  name: string
  connection_string: string
  management_port: number
  created_at: number
  updated_at: number
}

function rowToProfile(row: ProfileRow): ConnectionProfile {
  return {
    id: row.id,
    name: row.name,
    connectionString: row.connection_string,
    managementPort: row.management_port,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

export interface CreateProfileInput {
  name: string
  connectionString: string
  managementPort: number
}

export interface UpdateProfileInput {
  name?: string
  connectionString?: string
  managementPort?: number
}

export class ProfilesRepo {
  constructor(private db: Database) {}

  list(): ConnectionProfile[] {
    const rows = this.db
      .prepare('SELECT * FROM connection_profiles ORDER BY name')
      .all() as ProfileRow[]
    return rows.map(rowToProfile)
  }

  get(id: string): ConnectionProfile | undefined {
    const row = this.db.prepare('SELECT * FROM connection_profiles WHERE id = ?').get(id) as
      | ProfileRow
      | undefined
    return row ? rowToProfile(row) : undefined
  }

  create(input: CreateProfileInput): ConnectionProfile {
    const now = Date.now()
    const profile: ConnectionProfile = {
      id: randomUUID(),
      name: input.name,
      connectionString: input.connectionString,
      managementPort: input.managementPort,
      createdAt: now,
      updatedAt: now
    }
    this.db
      .prepare(
        `INSERT INTO connection_profiles
           (id, name, connection_string, management_port, created_at, updated_at)
         VALUES (@id, @name, @connectionString, @managementPort, @createdAt, @updatedAt)`
      )
      .run(profile)
    return profile
  }

  update(id: string, input: UpdateProfileInput): ConnectionProfile {
    const existing = this.get(id)
    if (!existing) {
      throw new AppError('NOT_FOUND', `profile not found: ${id}`)
    }
    const updated: ConnectionProfile = {
      ...existing,
      name: input.name ?? existing.name,
      connectionString: input.connectionString ?? existing.connectionString,
      managementPort: input.managementPort ?? existing.managementPort,
      updatedAt: Date.now()
    }
    this.db
      .prepare(
        `UPDATE connection_profiles
         SET name = @name, connection_string = @connectionString,
             management_port = @managementPort, updated_at = @updatedAt
         WHERE id = @id`
      )
      .run(updated)
    return updated
  }

  delete(id: string): void {
    this.db.prepare('DELETE FROM connection_profiles WHERE id = ?').run(id)
  }
}
