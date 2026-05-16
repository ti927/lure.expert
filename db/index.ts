import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema'

const connectionString = process.env.DATABASE_URL!

// Singleton para evitar múltiplas conexões em dev com hot reload
const globalForDb = globalThis as unknown as { _pgClient: postgres.Sql }

const client = globalForDb._pgClient ?? postgres(connectionString, { prepare: false })

if (process.env.NODE_ENV !== 'production') {
  globalForDb._pgClient = client
}

export const db = drizzle(client, { schema })
export type DB = typeof db
