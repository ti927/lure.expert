import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'

const connectionString = process.env.DATABASE_URL!

async function main() {
  const client = postgres(connectionString, { max: 1 })
  const db = drizzle(client)

  console.log('Rodando migrations...')
  await migrate(db, { migrationsFolder: './db/migrations' })
  console.log('Migrations concluídas.')

  await client.end()
}

main().catch((err) => {
  console.error('Erro nas migrations:', err)
  process.exit(1)
})
