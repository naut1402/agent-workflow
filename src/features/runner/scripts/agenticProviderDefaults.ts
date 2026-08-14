// UI-only hints for the 4 API-based agentic providers (openai/gemini/xai/anthropic)
// on ConnectionDialog.vue — placeholders shown next to the model/baseURL fields
// and the default secretRef hint prefilled when creating a credential for one
// of them. Pure data (no Vue import) so it is trivially unit-testable.

/** Placeholder base URL shown on the field — the real default lives in registry.ts. */
export const DEFAULT_BASE_URLS: Record<string, string> = {
  'openai-api': 'https://api.openai.com/v1',
  'gemini-api': 'https://generativelanguage.googleapis.com/v1beta/openai',
  'xai-api': 'https://api.x.ai/v1',
  'anthropic-api': 'https://api.anthropic.com',
}

/** Example model id shown as an input placeholder. */
export const DEFAULT_MODEL_HINTS: Record<string, string> = {
  'openai-api': 'gpt-4.1',
  'gemini-api': 'gemini-2.5-pro',
  'xai-api': 'grok-4',
  'anthropic-api': 'claude-opus-4-6',
}

/** Prefilled `secretRef` when opening "+ Credential" for this provider. */
export const DEFAULT_SECRET_ENV_HINTS: Record<string, string> = {
  'openai-api': 'env:OPENAI_API_KEY',
  'gemini-api': 'env:GEMINI_API_KEY',
  'xai-api': 'env:XAI_API_KEY',
  'anthropic-api': 'env:ANTHROPIC_API_KEY',
}
