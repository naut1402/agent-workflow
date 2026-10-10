import { z } from 'zod'
import { loadKnowledgeBundle } from '../../src/features/knowledge/business/index.js'
import { MAX_BUNDLE_IDS } from '../../src/features/knowledge/schemas/knowledge.js'
import { AbstractMcpTools, READ_ONLY_ANNOTATIONS, type ToolDef } from '../AbstractMcpTools.js'
import { ProjectRef } from './ProjectTools.js'

export class KnowledgeTools extends AbstractMcpTools {
  definitions(): ToolDef[] {
    return [
      {
        name: 'get_knowledge_bundle',
        access: 'read',
        hint: 'resolve `knowledge_inputs`.',
        config: {
          title: 'Get knowledge bundle',
          description:
            'Read knowledge entries by id (`<scope>/<slug>`, e.g. `global/coding-convention`). '
            + 'Resolves the ids listed in a task `knowledge_inputs`. Unknown ids come back as '
            + '{ id, error } instead of failing the whole call.',
          inputSchema: {
            ids: z.array(z.string()).max(MAX_BUNDLE_IDS).describe('Entry ids to read.'),
            project: ProjectRef.optional(),
          },
          annotations: READ_ONLY_ANNOTATIONS,
        },
        handler: (args) => this.getKnowledgeBundle(args),
      },
    ]
  }

  async getKnowledgeBundle({ ids, project }: { ids: string[]; project?: string }): Promise<any> {
    const gate = this.requireRoot(project)
    if ('error' in gate) return gate.error
    return this.ok({ bundle: await loadKnowledgeBundle(gate.root, ids) }, { structured: false })
  }
}
