export interface Migration {
  version: number
  sql: string
}

export const migrations: Migration[] = [
  {
    version: 1,
    sql: `
      CREATE TABLE connection_profiles (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        connection_string TEXT NOT NULL,
        management_port INTEGER NOT NULL DEFAULT 5300,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE preferences (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `
  }
]
