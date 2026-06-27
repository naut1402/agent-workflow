import { createClaudeCodeCliProvider } from './providers/claude-code-cli.js'

const providers = new Map()

function register(provider) {
  providers.set(provider.providerId, provider)
}

register(createClaudeCodeCliProvider())

export function getProvider(providerId) {
  return providers.get(providerId) || null
}

export function listProviderIds() {
  return [...providers.keys()]
}
