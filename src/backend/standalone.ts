#!/usr/bin/env bun
import http from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createApiHandler } from './devTeamApi.js'
import { createRegistryContext, seedDefault, list } from './registry.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const distDir = path.resolve(__dirname, '..', '..', 'dist')

const HOST = process.env.DEV_TEAM_DASHBOARD_HOST || '127.0.0.1'
const PORT = Number(process.env.DEV_TEAM_DASHBOARD_PORT || process.env.PORT || 5174)

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json; charset=utf-8',
}

function contentType(filePath: string): string {
  return CONTENT_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream'
}

function resolveStatic(pathname: string): string | null {
  const clean = decodeURIComponent(pathname.split('?')[0])
  const rel = clean === '/' ? 'index.html' : clean.replace(/^\/+/, '')
  const target = path.resolve(distDir, rel)
  if (target !== distDir && !target.startsWith(distDir + path.sep)) return null
  return target
}

async function serveStatic(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url || '/', 'http://localhost')
  let target = resolveStatic(url.pathname)

  if (target) {
    try {
      const stat = await fsp.stat(target)
      if (stat.isDirectory()) target = path.join(target, 'index.html')
    } catch {
      target = path.join(distDir, 'index.html')
    }
  } else {
    target = path.join(distDir, 'index.html')
  }

  try {
    const data = await fsp.readFile(target)
    res.statusCode = 200
    res.setHeader('Content-Type', contentType(target))
    res.end(data)
  } catch {
    res.statusCode = 404
    res.setHeader('Content-Type', 'text/plain; charset=utf-8')
    res.end('Not found. Did you run `bun run build` to produce dist/?')
  }
}

function main(): void {
  if (process.env.DEV_TEAM_ROOT) {
    try {
      const seeded = seedDefault(path.resolve(process.env.DEV_TEAM_ROOT))
      if (seeded) {
        console.log(`[dev-team-dashboard] seeded default project from DEV_TEAM_ROOT → ${seeded.path}`)
      }
    } catch (err: any) {
      console.warn(`[dev-team-dashboard] could not seed DEV_TEAM_ROOT: ${err.message || err}`)
    }
  }

  const ctx = createRegistryContext({
    defaultRoot: process.env.DEV_TEAM_ROOT ? path.resolve(process.env.DEV_TEAM_ROOT) : null,
  })
  const apiHandler = createApiHandler(ctx)

  const server = http.createServer(async (req, res) => {
    try {
      const handled = await apiHandler(req, res)
      if (handled) return
      await serveStatic(req, res)
    } catch (err: any) {
      res.statusCode = 500
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      res.end(JSON.stringify({ error: String(err && err.message ? err.message : err) }))
    }
  })

  server.listen(PORT, HOST, () => {
    // xem docs/architecture/code/backend.md §6
    process.env.DEV_TEAM_SELF_BASE_URL = `http://127.0.0.1:${PORT}`
    const { projects } = list()
    if (!fs.existsSync(distDir)) {
      console.warn(`[dev-team-dashboard] dist/ not found — run \`bun run build\` first (${distDir})`)
    }
    console.log(`\n  dev-team-dashboard (standalone) → http://${HOST}:${PORT}`)
    console.log(`  registry: ${projects.length} project(s)`)
    console.log('  add projects via the UI sidebar or the MCP `add_project` tool.\n')
  })
}

main()
