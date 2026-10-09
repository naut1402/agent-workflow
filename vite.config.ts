import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { devTeamApi } from './src/backend/devTeamApi.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const { version: appVersion } = JSON.parse(
  readFileSync(path.join(__dirname, 'package.json'), 'utf8'),
)

// xem docs/architecture/code/tooling.md §7
const root = process.env.DEV_TEAM_ROOT
  ? path.resolve(process.env.DEV_TEAM_ROOT)
  : path.resolve(process.cwd(), '..')

export default defineConfig({
  plugins: [vue(), devTeamApi({ root })],
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
