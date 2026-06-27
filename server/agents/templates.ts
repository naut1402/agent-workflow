import fs from 'node:fs/promises'
import path from 'node:path'
import yaml from 'js-yaml'
import { compileAgentMarkdown, emptyDraft } from '../../shared/agentMarkdown.js'
import { agentTemplatesDir } from './paths.js'

/** Seed `agent-templates/default-agent.md` if it does not exist yet. */
export async function ensureDefaultTemplate(root: string): Promise<void> {
  const dir = agentTemplatesDir(root)
  await fs.mkdir(dir, { recursive: true })
  const fp = path.join(dir, 'default-agent.md')
  try {
    await fs.access(fp)
  } catch {
    const draft = emptyDraft({
      name: 'default-agent',
      description: 'Agent mẫu — chỉnh sửa theo nhu cầu',
      sections: {
        role: 'Mô tả vai trò của agent.',
        workflow: '1. Bước đầu\n2. Bước tiếp theo',
        guardrail: '- Tuân thủ project rules',
        output: '- Ghi artifact vào task folder',
      },
    })
    await fs.writeFile(fp, compileAgentMarkdown(draft, yaml), 'utf8')
  }
}
