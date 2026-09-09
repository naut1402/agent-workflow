import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { devTeamApi } from './src/api/devTeamApi.js'

// The dashboard is scaffolded into `.dev-team-agent/viewer/`, so the data root
// (the `.dev-team-agent/` directory holding `.dev-state/` and `tasks/`) is the
// parent of the working directory. Allow an explicit override via DEV_TEAM_ROOT
// so the viewer can also be run from elsewhere pointing at any project.
//
// In dev mode this `root` becomes the ctx.defaultRoot (the project served when
// no `?project=<id>` is given) — preserving the legacy single-project behaviour.
// Multi-project support comes from the shared ProjectRegistry, exercised here
// too via `?project=` (see src/api/devTeamApi.ts → createApiHandler).

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const { version: appVersion } = JSON.parse(
  readFileSync(path.join(__dirname, 'package.json'), 'utf8'),
)

const root = process.env.DEV_TEAM_ROOT
  ? path.resolve(process.env.DEV_TEAM_ROOT)
  : path.resolve(process.cwd(), '..')

export default defineConfig({
  plugins: [vue(), devTeamApi({ root })],
  // Inject package.json version so the UI can display it without bundling the
  // whole package.json. Change version only in package.json — this follows.
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
  },
  css: {
    preprocessorOptions: {
      scss: {
        api: 'modern-compiler',
      },
    },
  },
  server: {
    port: 5174,
    strictPort: false,
    open: true,
  },
})
