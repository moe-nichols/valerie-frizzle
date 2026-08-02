import type { Database } from 'better-sqlite3'

export class PreferencesRepo {
  constructor(private db: Database) {}

  get(key: string): string | undefined {
    const row = this.db.prepare('SELECT value FROM preferences WHERE key = ?').get(key) as
      | { value: string }
      | undefined
    return row?.value
  }

  set(key: string, value: string): void {
    this.db
      .prepare(
        `INSERT INTO preferences (key, value) VALUES (@key, @value)
         ON CONFLICT(key) DO UPDATE SET value = @value`
      )
      .run({ key, value })
  }
}
