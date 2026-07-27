import { fetchUrlSafe } from '../agents/fetch.js'

export interface GithubIssuePreview {
  number: number
  title: string
  body: string | null
  labels: string[]
  url: string
  /** Default prompt built from issue title/body for the create-task dialog. */
  prompt: string
}

export type FetchGithubIssueResult =
  | { ok: true; issue: GithubIssuePreview }
  | { ok: false; status: number; error: string }

const ISSUE_URL_RE = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/issues\/(\d+)\/?(?:#.*)?$/

/** Parse a public GitHub issue URL into owner/repo/number — null when malformed. */
export function parseGithubIssueUrl(
  url: string,
): { owner: string; repo: string; number: number } | null {
  const trimmed = url.trim()
  let m: RegExpMatchArray | null
  try {
    m = new URL(trimmed).href.match(ISSUE_URL_RE)
  } catch {
    return null
  }
  if (!m) return null
  return { owner: m[1], repo: m[2], number: Number(m[3]) }
}

/** Build the default task brief shown in the create-task preview step. */
export function buildIssuePrompt(issue: {
  title: string
  body: string | null
  url: string
}): string {
  const parts = [`# ${issue.title}`, '', `Nguồn: ${issue.url}`]
  if (issue.body?.trim()) parts.push('', issue.body.trim())
  return parts.join('\n')
}

/**
 * Fetch a GitHub issue for preview before scaffolding a task.
 * Uses `fetchUrlSafe` (https-only, SSRF guards) against the REST API.
 */
export async function fetchGithubIssue(url: string): Promise<FetchGithubIssueResult> {
  const parsed = parseGithubIssueUrl(url)
  if (!parsed) {
    return { ok: false, status: 400, error: 'invalid GitHub issue URL' }
  }

  const apiUrl = `https://api.github.com/repos/${parsed.owner}/${parsed.repo}/issues/${parsed.number}`
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  }
  const token = process.env.GITHUB_TOKEN
  if (token) headers.Authorization = `Bearer ${token}`

  try {
    const text = await fetchUrlSafe(apiUrl, { headers })
    const data = JSON.parse(text) as Record<string, unknown>
    if (typeof data.number !== 'number') {
      return { ok: false, status: 502, error: 'invalid GitHub response' }
    }

    const labels = Array.isArray(data.labels)
      ? data.labels
          .map((l) => (typeof l === 'string' ? l : (l as { name?: string })?.name))
          .filter((name): name is string => typeof name === 'string' && name.length > 0)
      : []

    const issue = {
      number: data.number,
      title: String(data.title ?? ''),
      body: data.body != null ? String(data.body) : null,
      labels,
      url: String(data.html_url ?? url.trim()),
    }

    return {
      ok: true,
      issue: { ...issue, prompt: buildIssuePrompt(issue) },
    }
  } catch (err: unknown) {
    const msg = String((err as Error)?.message ?? err)
    if (msg.includes('fetch failed: 404')) {
      return { ok: false, status: 404, error: 'issue not found' }
    }
    if (msg.includes('fetch failed: 401')) {
      return { ok: false, status: 401, error: 'GitHub API unauthorized' }
    }
    if (msg.includes('fetch failed: 403')) {
      return { ok: false, status: 403, error: 'GitHub API forbidden' }
    }
    if (msg.includes('invalid URL') || msg.includes('only https') || msg.includes('private hosts')) {
      return { ok: false, status: 400, error: msg }
    }
    return { ok: false, status: 502, error: msg }
  }
}
