import { defineConfig } from 'drizzle-kit'

// Generates migrations for `src/backend/db/schema.ts`. Schema stays SQLite/Postgres
// portable, so moving to Postgres means adding a dialect config here, not a rewrite.
export default defineConfig({
  schema: './src/backend/db/schema.ts',
  out: './src/backend/db/migrations',
  dialect: 'sqlite',
})
