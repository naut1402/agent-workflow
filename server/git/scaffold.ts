import fs from 'node:fs'
import path from 'node:path'

/** Minimal orchestrator workspace dirs required by the dashboard API. */
export function scaffoldDevTeamWorkspace(projectRoot: string): string {
  const workspace = path.join(projectRoot, '.dev-team-agent')
  fs.mkdirSync(path.join(workspace, '.dev-state'), { recursive: true })
  fs.mkdirSync(path.join(workspace, 'tasks'), { recursive: true })
  return workspace
}

export function ensureDevTeamWorkspace(projectRoot: string): string {
  const workspace = path.join(projectRoot, '.dev-team-agent')
  if (fs.existsSync(workspace) && fs.statSync(workspace).isDirectory()) {
    return workspace
  }
  return scaffoldDevTeamWorkspace(projectRoot)
}
