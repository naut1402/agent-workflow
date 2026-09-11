/**
 * AgentDraft shape + section metadata — logic thuần, không YAML, không Node.
 *
 * Tách khỏi `agentMarkdown.js` để component Vue dùng được mà không kéo theo
 * `yamlLib` (module Node-only). Giữ file này **0 import**.
 */

export const DEFAULT_SECTION_ORDER = ['role', 'skills', 'workflow', 'guardrail', 'output']

export const SECTION_TITLES = {
  role: 'Vai trò',
  skills: 'Skills',
  workflow: 'Workflow',
  guardrail: 'Guardrail',
  output: 'Report output',
  unclassified: 'Chưa phân loại',
}

/** Sections that cannot be removed from the editor. */
export const FIXED_SECTION_KEYS = ['role', 'workflow']

export function getSectionTitle(key, draft = {}) {
  return draft.section_labels?.[key] || SECTION_TITLES[key] || key
}

export function ensureSectionOrder(draft) {
  const order = [...(draft.section_order || DEFAULT_SECTION_ORDER)]
  const sections = draft.sections || {}

  for (const key of FIXED_SECTION_KEYS) {
    if (!order.includes(key)) order.push(key)
  }

  for (const key of Object.keys(sections)) {
    if (sections[key]?.trim() && !order.includes(key)) order.push(key)
  }

  return order
}

export function emptyDraft(overrides = {}) {
  const draft = {
    name: '',
    description: '',
    model: 'claude-sonnet-4-6',
    skills: [],
    parameters: [],
    sections: {
      role: '',
      skills: '',
      workflow: '',
      guardrail: '',
      output: '',
      unclassified: '',
    },
    section_order: [...DEFAULT_SECTION_ORDER],
    section_labels: {},
    ...overrides,
  }
  draft.section_order = ensureSectionOrder(draft)
  return draft
}

export function draftFromCatalogAgent(agent) {
  const skills = agent.skills || []
  return emptyDraft({
    name: `${agent.name}-copy`,
    description: agent.description || '',
    skills: [...skills],
    sections: {
      role: `Agent dựa trên **${agent.name}** (${agent.source || agent.plugin}).\n\nMô tả gốc: ${agent.description || '—'}`,
      skills: skills.length ? skills.map((s) => `- ${s}`).join('\n') : '',
    },
  })
}
