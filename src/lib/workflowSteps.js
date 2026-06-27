/**
 * Parse / compile workflow section markdown ↔ builder steps.
 */

/** @typedef {{ title: string, body: string, pipelineStepId?: string }} WorkflowStep */

/** @returns {WorkflowStep[]} */
export function parseWorkflowMarkdown(text) {
  const raw = (text || '').trim()
  if (!raw) return []

  if (/^###\s+/m.test(raw)) {
    const parts = raw.split(/^###\s+/m).filter(Boolean)
    return parts.map((part, index) => {
      const nl = part.indexOf('\n')
      const titleLine = (nl >= 0 ? part.slice(0, nl) : part).trim()
      const body = (nl >= 0 ? part.slice(nl + 1) : '').trim()
      const titled = titleLine.match(/^(?:Bước\s*\d+\s*[:：]\s*)(.+)$/i)
      const title = titled ? titled[1].trim() : titleLine
      const pipelineMatch = body.match(/<!--\s*pipeline_step:(\S+)\s*-->/)
      return {
        title: title || `Bước ${index + 1}`,
        body: pipelineMatch ? body.replace(pipelineMatch[0], '').trim() : body,
        pipelineStepId: pipelineMatch ? pipelineMatch[1] : '',
      }
    })
  }

  const numbered = []
  const lines = raw.split('\n')
  let current = null
  for (const line of lines) {
    const m = line.match(/^\s*(\d+)[.)]\s+(.+)$/)
    if (m) {
      if (current) numbered.push(current)
      current = { title: m[2].trim(), body: '', pipelineStepId: '' }
    } else if (current && line.trim()) {
      current.body = current.body ? `${current.body}\n${line}` : line
    }
  }
  if (current) numbered.push(current)
  if (numbered.length) return numbered

  return [{ title: 'Bước 1', body: raw, pipelineStepId: '' }]
}

/** @param {WorkflowStep[]} steps */
export function compileWorkflowMarkdown(steps) {
  return (steps || [])
    .filter((s) => (s.title || '').trim() || (s.body || '').trim())
    .map((s, i) => {
      const title = (s.title || '').trim() || `Bước ${i + 1}`
      let body = (s.body || '').trim()
      if (s.pipelineStepId) {
        body = body ? `${body}\n\n<!-- pipeline_step:${s.pipelineStepId} -->` : `<!-- pipeline_step:${s.pipelineStepId} -->`
      }
      return `### Bước ${i + 1}: ${title}\n\n${body}`.trimEnd()
    })
    .join('\n\n')
}
