import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { devTeamApi } from './server/devTeamApi.js'

// The dashboard is scaffolded into `.dev-team-agent/viewer/`, so the data root
// (the `.dev-team-agent/` directory holding `.dev-state/` and `tasks/`) is the
// parent of the working directory. Allow an explicit override via DEV_TEAM_ROOT
// so the viewer can also be run from elsewhere pointing at any project.
//
// In dev mode this `root` becomes the ctx.defaultRoot (the project served when
// no `?project=<id>` is given) — preserving the legacy single-project behaviour.
// Multi-project support comes from the shared ProjectRegistry, exercised here
// too via `?project=` (see server/devTeamApi.js → createApiHandler).
import path from 'node:path'

const root = process.env.DEV_TEAM_ROOT
  ? path.resolve(process.env.DEV_TEAM_ROOT)
  : path.resolve(process.cwd(), '..')

export default defineConfig({
  plugins: [vue(), devTeamApi({ root })],
  server: {
    port: 5174,
    strictPort: false,
    open: true,
  },
})
