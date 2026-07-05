import type { Hono } from 'hono'
import type { HonoEnv } from '../types.js'
import { j } from '../respond.js'
import { emitAudit } from '../../logging/store.js'
import {
  AddApiProjectBodySchema,
  AddSshProjectBodySchema,
  parseAddProjectRequest,
  type Project,
} from '../../../shared/schemas/project.js'
import {
  ARTIFACT_SYNC_MAX_TOTAL_BYTES,
  SyncArtifactsRequestSchema,
  totalArtifactContentLength,
} from '../../../shared/schemas/artifact-sync.js'
import { normalizeGitUrlForMatch } from '../../../shared/git/url.js'
import { pullArtifacts, getRunnerForProject } from '../../workspace/sshSync.js'
import { getCredential } from '../../runners/credentials.js'

const pullCacheInFlight = new Set<string>()

function projectSummary(p: Project) {
  return {
    id: p.id,
    name: p.name,
    kind: p.kind,
    default: Boolean(p.default),
    source: p.source
      ? { url: p.source.url, branch: p.source.branch ?? null }
      : null,
  }
}

// Project registry CRUD — no per-project root needed.
export function registerRegistryRoutes(app: Hono<HonoEnv>): void {
  app.get('/api/projects/resolve', (c) => {
    const { registry } = c.get('ctx')
    const gitUrl = (c.req.query('gitUrl') || '').trim()
    const branch = (c.req.query('branch') || '').trim()
    if (!gitUrl) return j(c, 400, { error: 'gitUrl is required' })

    const want = normalizeGitUrlForMatch(gitUrl)
    if (!want) return j(c, 400, { error: 'invalid gitUrl' })

    const { projects, defaultId } = registry.list()
    const urlMatches = projects.filter((p) => {
      if (!p.source?.url) return false
      const got = normalizeGitUrlForMatch(p.source.url)
      return got !== null && got === want
    })

    if (branch) {
      const branchMatches = urlMatches.filter((p) => (p.source?.branch || '') === branch)
      if (branchMatches.length === 1) {
        return j(c, 200, {
          project: branchMatches[0],
          resolvedBy: 'gitUrl+branch',
          candidates: branchMatches.map(projectSummary),
        })
      }
      if (branchMatches.length > 1) {
        return j(c, 409, {
          error: 'multiple projects match gitUrl+branch',
          candidates: branchMatches.map(projectSummary),
        })
      }
      // Branch miss: if exactly one URL match, accept it (feature branch → registered branch).
      if (urlMatches.length === 1) {
        return j(c, 200, {
          project: urlMatches[0],
          resolvedBy: 'gitUrl',
          candidates: urlMatches.map(projectSummary),
        })
      }
      if (urlMatches.length > 1) {
        return j(c, 409, {
          error: 'no project matches branch; multiple projects share gitUrl',
          candidates: urlMatches.map(projectSummary),
        })
      }
    } else if (urlMatches.length === 1) {
      return j(c, 200, {
        project: urlMatches[0],
        resolvedBy: 'gitUrl',
        candidates: urlMatches.map(projectSummary),
      })
    } else if (urlMatches.length > 1) {
      return j(c, 409, {
        error: 'multiple projects match gitUrl',
        candidates: urlMatches.map(projectSummary),
      })
    }

    return j(c, 404, {
      error: 'no project matches gitUrl',
      candidates: projects.map(projectSummary),
      defaultId,
    })
  })

  app.get('/api/projects', (c) => {
    const { registry } = c.get('ctx')
    const id = c.req.query('id')
    if (id) {
      const project = registry.get(id)
      if (!project) return j(c, 404, { error: 'unknown project', id })
      return j(c, 200, { project })
    }
    const name = (c.req.query('name') || '').trim()
    if (name) {
      const { projects, defaultId } = registry.list()
      const matches = projects.filter((p) => p.name === name)
      return j(c, 200, {
        projects: matches,
        defaultId,
        candidates: matches.map(projectSummary),
      })
    }
    return j(c, 200, registry.list())
  })

  app.post('/api/projects/:id/sync', async (c) => {
    const id = c.req.param('id')
    const { registry } = c.get('ctx')
    const result = await registry.syncGitProject(id)
    if ('error' in result) return j(c, result.status || 400, { error: result.error })
    emitAudit({
      op: 'update',
      entity: 'project',
      identifier: id,
      projectId: id,
      detail: { action: 'git-sync' },
    })
    return j(c, 200, { project: result.project, syncedAt: result.syncedAt })
  })

  // Transport HTTP API upload (Luồng B) — dev machine đọc file dưới
  // `.dev-team-agent/**` (whitelist) và gửi nguyên văn qua HTTP; server ghi
  // thẳng vào project.path (artifactCache riêng của kind 'api').
  app.post('/api/projects/:id/artifacts', async (c) => {
    const id = c.req.param('id')
    const { registry } = c.get('ctx')
    let raw: unknown
    try {
      raw = JSON.parse((await c.req.text()) || '{}')
    } catch {
      return j(c, 400, { error: 'invalid JSON' })
    }
    const parsed = SyncArtifactsRequestSchema.safeParse(raw)
    if (!parsed.success) return j(c, 400, { error: parsed.error.issues[0]?.message || 'invalid body' })

    const totalBytes = totalArtifactContentLength(parsed.data.files)
    if (totalBytes > ARTIFACT_SYNC_MAX_TOTAL_BYTES) {
      return j(c, 400, {
        error: `payload too large: total content length ${totalBytes} exceeds ${ARTIFACT_SYNC_MAX_TOTAL_BYTES} bytes`,
      })
    }

    const result = await registry.syncArtifactsProject(id, parsed.data.files)
    if ('error' in result) return j(c, result.status || 400, { error: result.error })
    emitAudit({
      op: 'update',
      entity: 'project',
      identifier: id,
      projectId: id,
      detail: { action: 'artifact-sync', filesWritten: result.filesWritten, filesDeleted: result.filesDeleted },
    })
    return j(c, 200, {
      project: result.project,
      syncedAt: result.syncedAt,
      filesWritten: result.filesWritten,
      filesDeleted: result.filesDeleted,
    })
  })

  app.post('/api/projects', async (c) => {
    const { registry } = c.get('ctx')
    let raw: unknown
    try {
      raw = JSON.parse((await c.req.text()) || '{}')
    } catch {
      return j(c, 400, { error: 'invalid JSON' })
    }

    const apiParsed = AddApiProjectBodySchema.safeParse(raw)
    const sshParsed = AddSshProjectBodySchema.safeParse(raw)
    let resolved:
      | Awaited<ReturnType<typeof registry.addFromGit>>
      | ReturnType<typeof registry.addSshProject>
      | ReturnType<typeof registry.addApiProject>
    if (apiParsed.success) {
      resolved = registry.addApiProject(apiParsed.data)
    } else if (sshParsed.success) {
      resolved = registry.addSshProject(sshParsed.data)
    } else {
      const parsed = parseAddProjectRequest(raw)
      if (!parsed.success) {
        return j(c, 400, { error: parsed.error.issues[0]?.message || 'invalid body' })
      }
      const body = parsed.data
      resolved = body.gitUrl
        ? await registry.addFromGit({ gitUrl: body.gitUrl, branch: body.branch, name: body.name })
        : registry.add({ path: body.path!, name: body.name })
    }

    if ('error' in resolved) return j(c, resolved.status || 400, { error: resolved.error })
    emitAudit({
      op: 'create',
      entity: 'project',
      identifier: resolved.project?.id ?? null,
      projectId: resolved.project?.id ?? null,
    })
    return j(c, 201, { project: resolved.project })
  })

  app.post('/api/projects/:id/pull-cache', async (c) => {
    const { registry } = c.get('ctx')
    const id = c.req.param('id')
    const project = registry.get(id)
    if (!project) return j(c, 404, { error: 'unknown project' })
    if (project.kind !== 'ssh' || !project.remote) {
      return j(c, 400, { error: 'project is not SSH kind' })
    }

    const runner = getRunnerForProject(project)
    if (!runner) return j(c, 400, { error: 'SSH runner not found' })
    const credential = getCredential(runner.credentialId)
    if (!credential) return j(c, 400, { error: 'credential not found' })

    if (pullCacheInFlight.has(id)) {
      return j(c, 409, { error: 'pull already in progress' })
    }
    pullCacheInFlight.add(id)
    try {
      const result = await pullArtifacts({ project, runner, credential })
      if ('error' in result) return j(c, 502, result)
      return j(c, 200, result)
    } finally {
      pullCacheInFlight.delete(id)
    }
  })

  app.delete('/api/projects', (c) => {
    const { registry } = c.get('ctx')
    const id = c.req.query('id') || ''
    const result = registry.remove(id)
    if ('error' in result) return j(c, result.status || 400, { error: result.error })
    emitAudit({ op: 'delete', entity: 'project', identifier: id, projectId: id })
    return j(c, 200, { removed: true })
  })

  app.all('/api/projects', (c) => j(c, 405, { error: 'method not allowed' }))
}
