import { defineConfig } from 'drizzle-kit'

// Generates migrations for `src/core/db/schema.ts`. Schema stays SQLite/Postgres
// portable, so moving to Postgres means adding a dialect config here, not a rewrite.
export default defineConfig({
  schema: './src/core/db/schema.ts',
  out: './src/core/db/migrations',
  dialect: 'sqlite',
})
