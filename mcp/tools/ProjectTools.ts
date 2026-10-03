import { z } from 'zod'
import { emitEntity } from '../../src/backend/events/index.js'
import { emitAudit } from '../../src/backend/log/index.js'
import { add, get, list, remove } from '../../src/backend/registry.js'
import { AbstractMcpTools, READ_ONLY_ANNOTATIONS, type ToolDef } from '../AbstractMcpTools.js'

// xem docs/mcp/server.md §4.1
const ProjectOut = z
  .object({
    id: z.string(),
    name: z.string(),
    kind: z.string().optional(),
    path: z.string(),
    addedAt: z.string().optional(),
    default: z.boolean().optional(),
  })
  .passthrough()

export class ProjectTools extends AbstractMcpTools {
  definitions(): ToolDef[] {
    return [
      {
        name: 'list_projects',
        access: 'read',
        config: {
          title: 'List projects',
          description: 'List all dev-team workspaces registered in the dashboard project registry.',
          inputSchema: {},
          outputSchema: { projects: z.array(ProjectOut), defaultId: z.string().nullable() },
          annotations: READ_ONLY_ANNOTATIONS,
        },
        handler: () => this.listProjects(),
      },
      {
        name: 'get_project',
        access: 'read',
        config: {
          title: 'Get project',
          description: 'Get one registered project by its id.',
          inputSchema: { id: z.string().min(1).describe('Project id (from list_projects).') },
          outputSchema: { project: ProjectOut },
          annotations: READ_ONLY_ANNOTATIONS,
        },
        handler: (args) => this.getProject(args),
      },
      {
        name: 'add_project',
        access: 'write',
        config: {
          title: 'Add project',
          description:
            'Register a dev-team workspace. `path` must be an absolute path to a '
            + '`.dev-team-agent` directory (or a project root containing one). Idempotent.',
          inputSchema: {
            path: z.string().min(1).describe('Absolute path to a .dev-team-agent dir or its project root.'),
            name: z.string().optional().describe('Optional display name (defaults to the project folder name).'),
          },
          outputSchema: { project: ProjectOut },
          annotations: { idempotentHint: true, destructiveHint: false, openWorldHint: false },
        },
        handler: (args) => this.addProject(args),
      },
      {
        name: 'remove_project',
        access: 'write',
        config: {
          title: 'Remove project',
          description:
            'Remove a project from the registry by id. Does NOT delete any files on disk. '
            + 'Removing the default project promotes the next remaining project (if any) to default.',
          inputSchema: { id: z.string().min(1).describe('Project id to remove.') },
          outputSchema: { removed: z.literal(true) },
          annotations: { destructiveHint: true, idempotentHint: true, openWorldHint: false },
        },
        handler: (args) => this.removeProject(args),
      },
    ]
  }

  listProjects(): any {
    return this.ok(list())
  }

  getProject({ id }: { id: string }): any {
    const project = get(id)
    if (!project) return this.fail('not_found', `unknown project: ${id}`)
    return this.ok({ project })
  }

  // xem docs/mcp/server.md §8.4
  addProject({ path: inputPath, name }: { path: string; name?: string }): any {
    const result = add({ path: inputPath, name })
    if ('error' in result) return this.fail('invalid_input', result.error)
    const id = result.project?.id ?? null
    emitAudit({ op: 'create', entity: 'project', identifier: id, projectId: id })
    emitEntity('created', 'project', { id, projectId: id })
    return this.ok({ project: result.project })
  }

  removeProject({ id }: { id: string }): any {
    const result = remove(id)
    if ('error' in result) return this.fail('not_found', result.error)
    emitAudit({ op: 'delete', entity: 'project', identifier: id, projectId: id })
    emitEntity('deleted', 'project', { id, projectId: id })
    return this.ok({ removed: true as const })
  }
}
