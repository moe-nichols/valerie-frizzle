import Database from 'better-sqlite3'
import { migrations } from './migrations'

export function createDatabase(dbPath: string): Database.Database {
  const db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  runMigrations(db)
  return db
}

function runMigrations(db: Database.Database): void {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY)')
  const appliedVersions = new Set(
    (db.prepare('SELECT version FROM schema_migrations').all() as { version: number }[]).map(
      (row) => row.version
    )
  )
  const applyMigration = db.transaction((version: number, sql: string) => {
    db.exec(sql)
    db.prepare('INSERT INTO schema_migrations (version) VALUES (?)').run(version)
  })
  for (const migration of migrations) {
    if (appliedVersions.has(migration.version)) continue
    applyMigration(migration.version, migration.sql)
  }
}
