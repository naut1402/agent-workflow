/**
 * Parse / compile custom agent markdown ↔ AgentDraft JSON.
 */

const DEFAULT_SECTION_ORDER = ['role', 'skills', 'workflow', 'guardrail', 'output']

const SECTION_TITLES = {
  role: 'Vai trò',
  skills: 'Skills',
  workflow: 'Workflow',
  guardrail: 'Guardrail',
  output: 'Report output',
  unclassified: 'Chưa phân loại',
}

/** Sections that cannot be removed from the editor. */
export const FIXED_SECTION_KEYS = ['role', 'workflow']

const HEADING_ALIASES = {
  'vai trò': 'role',
  workflow: 'workflow',
  skills: 'skills',
  guardrail: 'guardrail',
  'report output': 'output',
  'kết quả trả về': 'output',
  'kết quả': 'output',
}

function normalizeHeading(heading) {
  return (heading || '').trim().toLowerCase()
}

export function resolveSectionKey(heading) {
  const norm = normalizeHeading(heading)
  if (!norm) return null

  const exact = Object.entries(SECTION_TITLES).find(
    ([, title]) => normalizeHeading(title) === norm,
  )?.[0]
  if (exact) return exact

  if (HEADING_ALIASES[norm]) return HEADING_ALIASES[norm]

  for (const [key, title] of Object.entries(SECTION_TITLES)) {
    if (key === 'unclassified') continue
    const t = normalizeHeading(title)
    if (norm === key || norm.includes(key) || norm.includes(t) || t.includes(norm)) {
      return key
    }
  }
  return null
}

function appendUnclassified(sections, heading, content) {
  const block = heading ? `## ${heading}\n\n${content}` : content
  if (!block.trim()) return
  sections.unclassified = sections.unclassified
    ? `${sections.unclassified.trim()}\n\n${block}`.trim()
    : block.trim()
}

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

/** Parse agent markdown (pass js-yaml `yaml` on server). */
export function parseAgentMarkdown(raw, yaml) {
  const lines = raw.split(/\r?\n/)
  if (lines[0]?.trim() !== '---') {
    return emptyDraft({ sections: { role: raw } })
  }
  const end = lines.findIndex((line, i) => i > 0 && line.trim() === '---')
  if (end < 0) return emptyDraft()
  const fmText = lines.slice(1, end).join('\n')
  let body = lines.slice(end + 1).join('\n').trim()
  let fm = {}
  if (yaml) {
    try {
      fm = yaml.load(fmText) || {}
    } catch {
      fm = {}
    }
  }

  const draft = emptyDraft({
    name: fm.name || '',
    description: fm.description || '',
    model: fm.model || 'claude-sonnet-4-6',
    skills: Array.isArray(fm.skills) ? fm.skills : [],
    parameters: Array.isArray(fm.parameters) ? fm.parameters : [],
    section_order: Array.isArray(fm.section_order) ? fm.section_order : [...DEFAULT_SECTION_ORDER],
    section_labels:
      fm.section_labels && typeof fm.section_labels === 'object' ? fm.section_labels : {},
  })

  const sections = { ...draft.sections }
  if (!body) {
    return {
      ...draft,
      sections,
      editable: fm.editable !== false,
      created_by: fm.created_by,
    }
  }

  const h1Match = body.match(/^#\s+(.+?)(?:\n+([\s\S]*?))?(?=\n## |\s*$)/)
  if (h1Match) {
    const h1Title = h1Match[1].trim()
    const h1Body = (h1Match[2] || '').trim()
    appendUnclassified(sections, h1Title, h1Body)
    body = body.slice(h1Match[0].length).trim()
  }

  const parts = body.split(/^## /m).filter(Boolean)
  if (!parts.length && body.trim()) {
    appendUnclassified(sections, '', body.trim())
  }

  for (const part of parts) {
    const nl = part.indexOf('\n')
    const heading = (nl >= 0 ? part.slice(0, nl) : part).trim()
    const content = (nl >= 0 ? part.slice(nl + 1) : '').trim()
    const key = resolveSectionKey(heading)
    if (key) {
      sections[key] = sections[key] ? `${sections[key].trim()}\n\n${content}`.trim() : content
    } else {
      appendUnclassified(sections, heading, content)
    }
  }

  const parsed = {
    ...draft,
    sections,
    section_order: ensureSectionOrder({ ...draft, sections }),
    editable: fm.editable !== false,
    created_by: fm.created_by,
  }
  return parsed
}

export function compileAgentMarkdown(draft, yaml) {
  const fm = {
    name: draft.name,
    description: draft.description || '',
    model: draft.model || 'claude-sonnet-4-6',
    skills: draft.skills || [],
    created_by: 'dashboard',
    editable: true,
    section_order: ensureSectionOrder(draft),
  }
  if (draft.parameters?.length) fm.parameters = draft.parameters
  if (draft.section_labels && Object.keys(draft.section_labels).length) {
    fm.section_labels = draft.section_labels
  }

  const order = fm.section_order
  const bodyParts = order
    .map((key) => {
      const text = (draft.sections?.[key] || '').trim()
      if (!text) return ''
      return `## ${getSectionTitle(key, draft)}\n\n${text}`
    })
    .filter(Boolean)

  const fmYaml = yaml.dump(fm, { lineWidth: 120 }).trim()
  return `---\n${fmYaml}\n---\n\n${bodyParts.join('\n\n')}\n`
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

/** Build draft from full agent markdown (catalog copy). */
export function draftFromAgentMarkdown(raw, yaml, agentMeta = {}) {
  const parsed = parseAgentMarkdown(raw, yaml)
  return emptyDraft({
    name: `${agentMeta.name || parsed.name || 'agent'}-copy`,
    description: parsed.description || agentMeta.description || '',
    model: parsed.model || 'claude-sonnet-4-6',
    skills: parsed.skills?.length ? [...parsed.skills] : [...(agentMeta.skills || [])],
    parameters: parsed.parameters ? [...parsed.parameters] : [],
    sections: { ...parsed.sections },
    section_order: [...parsed.section_order],
    section_labels: { ...(parsed.section_labels || {}) },
  })
}

export function slugifySectionKey(title) {
  const base = (title || 'section')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 32)
  return base || 'section'
}

export function heuristicDraftFromDescription(description) {
  const lower = (description || '').toLowerCase()
  const draft = emptyDraft({
    name: 'custom-agent',
    description: description.slice(0, 200),
  })
  draft.sections.role = description
  if (/review|đánh giá/.test(lower)) {
    draft.skills = ['coding-rules']
    draft.sections.workflow = '1. Đọc diff\n2. Ghi review.md'
  } else if (/investigat|điều tra|survey/.test(lower)) {
    draft.skills = ['survey-codebase']
    draft.sections.workflow = '1. Survey codebase\n2. Ghi investigate.md'
  } else if (/design|thiết kế/.test(lower)) {
    draft.skills = ['write-design']
    draft.sections.workflow = '1. Đọc investigate.md\n2. Viết design.md'
  }
  draft.sections.guardrail = '- Không đoán mò — cần code evidence\n- Dừng nếu blocking question'
  draft.sections.output = '- Artifact markdown trong `.dev-team-agent/tasks/<id>/`'
  return draft
}

export { DEFAULT_SECTION_ORDER, SECTION_TITLES }
