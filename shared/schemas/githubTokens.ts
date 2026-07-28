import { z } from 'zod'

/** `owner/repo` — GitHub repository slug used to look up a PAT. */
const REPO_SLUG_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/

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

/** Normalise slug to lowercase `owner/repo` for map lookups. */
export function normaliseRepoSlug(repo: string): string {
  return String(repo).trim().replace(/^\/+|\/+$/g, '').toLowerCase()
}

export function isValidRepoSlug(repo: string): boolean {
  return REPO_SLUG_RE.test(normaliseRepoSlug(repo))
}

export function parseGithubTokensConfig(raw: unknown): GithubTokensConfig {
  const parsed = GithubTokensConfigSchema.safeParse(raw)
  if (!parsed.success) return { repos: [] }

  // Dedupe by normalised slug — last entry wins; skip invalid slugs.
  const bySlug = new Map<string, GithubRepoToken>()
  for (const entry of parsed.data.repos) {
    const repo = normaliseRepoSlug(entry.repo)
    const token = entry.token.trim()
    if (!REPO_SLUG_RE.test(repo) || !token) continue
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
  const slug = normaliseRepoSlug(`${owner}/${repo}`)
  const match = (config?.repos ?? []).find((e) => normaliseRepoSlug(e.repo) === slug)
  if (match?.token) return match.token
  const fallback = envToken?.trim()
  return fallback ? fallback : null
}
