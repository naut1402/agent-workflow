import { z } from 'zod'

/** `owner/repo` — GitHub repository slug used to look up a PAT. */
const REPO_SLUG_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/

/** Accepts https://github.com/owner/repo[...], git@github.com:owner/repo.git, or owner/repo. */
const GITHUB_HTTPS_RE =
  /^https?:\/\/(?:www\.)?github\.com\/([^/]+)\/([^/#?\s]+?)(?:\.git)?(?:\/.*)?(?:[?#].*)?$/i
const GITHUB_SSH_RE = /^git@github\.com:([^/]+)\/([^/#?\s]+?)(?:\.git)?$/i

export const GithubRepoTokenSchema = z.object({
  /** Repository slug `owner/repo` (case-insensitive match at resolve time). */
  repo: z.string().trim().min(1),
  /** Personal access token (or fine-grained token) with `issues:read` (or broader). */
  token: z.string().trim().min(1),
})

export type GithubRepoToken = z.infer<typeof GithubRepoTokenSchema>

export const GithubTokensConfigSchema = z.object({
  repos: z.array(GithubRepoTokenSchema).default([]),
})

export type GithubTokensConfig = z.infer<typeof GithubTokensConfigSchema>

export const DEFAULT_GITHUB_TOKENS_CONFIG: GithubTokensConfig = {
  repos: [],
}

/**
 * Extract `owner/repo` from a slug, HTTPS URL, SSH URL, or issue/PR URL.
 * Returns null when the input cannot be mapped to a GitHub repo.
 */
export function parseGithubRepoRef(input: string): string | null {
  const trimmed = String(input).trim()
  if (!trimmed) return null

  let owner: string | undefined
  let repo: string | undefined

  const https = trimmed.match(GITHUB_HTTPS_RE)
  if (https) {
    owner = https[1]
    repo = https[2]
  } else {
    const ssh = trimmed.match(GITHUB_SSH_RE)
    if (ssh) {
      owner = ssh[1]
      repo = ssh[2]
    } else {
      const bare = trimmed.replace(/^\/+|\/+$/g, '')
      if (REPO_SLUG_RE.test(bare)) {
        const [o, r] = bare.split('/')
        owner = o
        repo = r
      }
    }
  }

  if (!owner || !repo) return null
  const slug = `${owner}/${repo}`.toLowerCase()
  return REPO_SLUG_RE.test(slug) ? slug : null
}

/** Lowercase slug helper — prefers `parseGithubRepoRef` when the input is a URL. */
export function normaliseRepoSlug(repo: string): string {
  return parseGithubRepoRef(repo) ?? String(repo).trim().replace(/^\/+|\/+$/g, '').toLowerCase()
}

export function isValidRepoSlug(repo: string): boolean {
  return parseGithubRepoRef(repo) != null
}

export function parseGithubTokensConfig(raw: unknown): GithubTokensConfig {
  const parsed = GithubTokensConfigSchema.safeParse(raw)
  if (!parsed.success) return { repos: [] }

  // Dedupe by normalised slug — last entry wins; skip invalid refs.
  const bySlug = new Map<string, GithubRepoToken>()
  for (const entry of parsed.data.repos) {
    const repo = parseGithubRepoRef(entry.repo)
    const token = entry.token.trim()
    if (!repo || !token) continue
    bySlug.set(repo, { repo, token })
  }
  return { repos: [...bySlug.values()] }
}

/**
 * Resolve a token for `owner/repo`.
 * Prefers a matching entry in config; falls back to `envToken` (e.g. `GITHUB_TOKEN`).
 */
export function resolveGithubTokenForRepo(
  config: GithubTokensConfig | null | undefined,
  owner: string,
  repo: string,
  envToken?: string | null,
): string | null {
  const slug = parseGithubRepoRef(`${owner}/${repo}`)
  if (!slug) {
    const fallback = envToken?.trim()
    return fallback ? fallback : null
  }
  const match = (config?.repos ?? []).find((e) => parseGithubRepoRef(e.repo) === slug)
  if (match?.token) return match.token
  const fallback = envToken?.trim()
  return fallback ? fallback : null
}
