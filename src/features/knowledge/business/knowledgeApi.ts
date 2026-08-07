import { getKnowledgeDriver } from './fileDriver.js'
import { scanProjectDocuments, readCandidateContent } from './scanDocs.js'
import { listKnowledgeRevisions, restoreKnowledgeRevision, snapshotKnowledgeRevision } from './versions.js'
import path from 'node:path'

function json(res, status, body) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(body))
}

async function readBody(req) {
  let body = ''
  for await (const chunk of req) body += chunk
  return body
}

function parseMultipart(ctype: string, body: string) {
  const boundary = ctype.split('boundary=')[1]
  if (!boundary) return null
  const parts = body.split(`--${boundary}`)
  const fields: Record<string, string> = {}
  let file: { filename: string; content: string } | null = null
  for (const part of parts) {
    if (!part.includes('Content-Disposition')) continue
    const nameMatch = /name="([^"]+)"/.exec(part)
    const fnMatch = /filename="([^"]+)"/.exec(part)
    const idx = part.indexOf('\r\n\r\n')
    if (idx < 0) continue
    const value = part.slice(idx + 4).replace(/\r\n--$/, '').replace(/\r\n$/, '').trim()
    const name = nameMatch?.[1]
    if (!name) continue
    if (fnMatch) {
      file = { filename: fnMatch[1], content: value }
    } else {
      fields[name] = value
    }
  }
  return { fields, file }
}

export async function handleKnowledgeApi(req, res, url, root) {
  if (!url.pathname.startsWith('/api/knowledge')) return false

  const { driver } = await getKnowledgeDriver(root)

  if (url.pathname === '/api/knowledge/tags' && req.method === 'GET') {
    const tags = await driver.listTags()
    json(res, 200, { tags })
    return true
  }

  if (url.pathname === '/api/knowledge/scan' && req.method === 'GET') {
    // Project repo root = parent of .dev-team-agent
    const projectRoot = path.dirname(root)
    const result = scanProjectDocuments(projectRoot)
    json(res, 200, result)
    return true
  }

  if (url.pathname === '/api/knowledge/scan/ingest' && req.method === 'POST') {
    let parsed
    try {
      parsed = JSON.parse(await readBody(req))
    } catch {
      json(res, 400, { error: 'invalid JSON' })
      return true
    }
    const relativePath = String(parsed.relativePath || '')
    const projectRoot = path.dirname(root)
    const content = readCandidateContent(projectRoot, relativePath)
    if (content == null) {
      json(res, 400, { error: 'cannot read candidate' })
      return true
    }
    const scope = parsed.scope === 'system' ? 'system' : 'project'
    const slug =
      String(parsed.slug || relativePath.replace(/[/\\]/g, '-').replace(/\.(md|mdx|txt)$/i, '')).slice(0, 64)
    try {
      const entry = await driver.write({
        id: `${scope}/${slug}`,
        title: parsed.title || slug,
        content,
        scope,
        tags: Array.isArray(parsed.tags) ? parsed.tags : ['scanned'],
      })
      json(res, 201, { entry })
    } catch (e) {
      json(res, 400, { error: String(e.message || e) })
    }
    return true
  }

  if (url.pathname === '/api/knowledge/versions' && req.method === 'GET') {
    const id = url.searchParams.get('id') || ''
    const [scope, ...rest] = id.split('/')
    const slug = rest.join('/')
    if ((scope !== 'project' && scope !== 'system') || !slug) {
      json(res, 400, { error: 'id must be scope/slug' })
      return true
    }
    json(res, 200, { revisions: listKnowledgeRevisions(root, scope, slug) })
    return true
  }

  if (url.pathname === '/api/knowledge/versions/restore' && req.method === 'POST') {
    let parsed
    try {
      parsed = JSON.parse(await readBody(req))
    } catch {
      json(res, 400, { error: 'invalid JSON' })
      return true
    }
    const id = String(parsed.id || '')
    const revisionId = String(parsed.revisionId || '')
    const [scope, ...rest] = id.split('/')
    const slug = rest.join('/')
    const result = restoreKnowledgeRevision(root, scope, slug, revisionId)
    if ('error' in result) {
      json(res, 400, { error: result.error })
      return true
    }
    json(res, 200, { restored: true })
    return true
  }

  if (url.pathname === '/api/knowledge/upload' && req.method === 'POST') {
    const ctype = req.headers['content-type'] || ''
    if (!ctype.includes('multipart/form-data')) {
      json(res, 400, { error: 'multipart/form-data required' })
      return true
    }
    const body = await readBody(req)
    const parsed = parseMultipart(ctype, body)
    if (!parsed?.file?.content) {
      json(res, 400, { error: 'no file content' })
      return true
    }
    const scope = parsed.fields.scope === 'system' ? 'system' : 'project'
    const tags = parsed.fields.tags ? parsed.fields.tags.split(/[,;]+/) : []
    try {
      const entry = await driver.upload({
        filename: parsed.file.filename,
        content: parsed.file.content,
        scope,
        tags,
        title: parsed.fields.title || undefined,
      })
      json(res, 201, { entry })
    } catch (e) {
      json(res, 400, { error: String(e.message || e) })
    }
    return true
  }

  if (url.pathname === '/api/knowledge') {
    if (req.method === 'GET') {
      const id = url.searchParams.get('id')
      if (id) {
        try {
          const entry = await driver.read(id)
          json(res, 200, { entry })
        } catch {
          json(res, 404, { error: 'not found', id })
        }
        return true
      }
      const tags = url.searchParams.get('tags')
      const scope = url.searchParams.get('scope') || undefined
      const query = url.searchParams.get('q') || undefined
      const entries = await driver.list({
        scope,
        query,
        tags: tags ? tags.split(',').filter(Boolean) : undefined,
      })
      json(res, 200, { entries })
      return true
    }

    if (req.method === 'POST') {
      let parsed
      try {
        parsed = JSON.parse(await readBody(req))
      } catch {
        json(res, 400, { error: 'invalid JSON' })
        return true
      }
      try {
        const entry = await driver.write(parsed)
        json(res, 201, { entry })
      } catch (e) {
        json(res, 400, { error: String(e.message || e) })
      }
      return true
    }

    if (req.method === 'PUT') {
      const id = url.searchParams.get('id')
      if (!id) {
        json(res, 400, { error: 'missing id' })
        return true
      }
      let parsed
      try {
        parsed = JSON.parse(await readBody(req))
      } catch {
        json(res, 400, { error: 'invalid JSON' })
        return true
      }
      try {
        const [scope, ...rest] = id.split('/')
        const slug = rest.join('/')
        if ((scope === 'project' || scope === 'system') && slug) {
          snapshotKnowledgeRevision(root, scope, slug)
        }
        const entry = await driver.write({ ...parsed, id })
        json(res, 200, { entry })
      } catch (e) {
        json(res, 400, { error: String(e.message || e) })
      }
      return true
    }

    if (req.method === 'DELETE') {
      const id = url.searchParams.get('id')
      if (!id) {
        json(res, 400, { error: 'missing id' })
        return true
      }
      try {
        const result = await driver.delete(id)
        json(res, 200, result)
      } catch {
        json(res, 404, { error: 'not found', id })
      }
      return true
    }
  }

  json(res, 404, { error: 'not found' })
  return true
}
