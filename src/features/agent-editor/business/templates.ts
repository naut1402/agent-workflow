import { access, dirname, joinPath, mkdir, readTextFile, writeTextFile } from '../../../core/lib/fileHelper.js'
import { fileURLToPath } from 'node:url'
import { compileAgentMarkdown, emptyDraft } from '../../../core/contracts/agentMarkdown.js'
import { agentTemplatesDir, customAgentsDir } from './paths.js'

/** Seed `agent-templates/default-agent.md` if it does not exist yet. */
export async function ensureDefaultTemplate(root: string): Promise<void> {
  const dir = agentTemplatesDir(root)
  await mkdir(dir, { recursive: true })
  const fp = joinPath(dir, 'default-agent.md')
  try {
    await access(fp)
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
    await writeTextFile(fp, compileAgentMarkdown(draft))
  }
}

/** Absolute path of the bundled `nl-chat-builder.md` source, alongside this file. */
function bundledNlChatBuilderPath(): string {
  const here = dirname(fileURLToPath(import.meta.url))
  return joinPath(here, 'templates', 'nl-chat-builder.md')
}

/**
 * Seed `custom-agents/nl-chat-builder.md` (the agent `submitJob` resolves via
 * `agentRef: 'dashboard:nl-chat-builder'`) from the bundled default the first
 * time the NL chat surface is used for this project. Never overwrites an
 * existing file — a user may have customized it.
 */
export async function ensureNlChatBuilderAgent(root: string): Promise<void> {
  const dir = customAgentsDir(root)
  await mkdir(dir, { recursive: true })
  const fp = joinPath(dir, 'nl-chat-builder.md')
  try {
    await access(fp)
  } catch {
    const bundled = await readTextFile(bundledNlChatBuilderPath())
    await writeTextFile(fp, bundled)
  }
}
