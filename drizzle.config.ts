import { defineConfig } from 'drizzle-kit'

// Generates migrations for `src/core/db/schema.ts`. Schema stays SQLite/Postgres
// portable — Phase 2 (design.md §3.3) only needs to add a Postgres dialect config
// here, not rewrite the schema.
export default defineConfig({
  schema: './src/core/db/schema.ts',
  out: './src/core/db/migrations',
  dialect: 'sqlite',
})
