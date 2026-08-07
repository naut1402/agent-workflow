import { joinPath, mkdirSync, readTextFileSync, renameSync, writeTextFileSync } from '../../../core/lib/fileHelper.js'
import { registryHome } from '../../../core/registry.js'
import {
  COMMANDS_VERSION,
  sanitiseCommandId,
  type CommandsStore,
  type CustomCommand,
  type MutationResult,
} from './types.js'

function commandsFile(): string {
  return joinPath(registryHome(), 'commands.json')
}

function emptyStore(): CommandsStore {
  return { version: COMMANDS_VERSION, commands: [] }
}

function normaliseCommand(raw: any): CustomCommand | null {
  const id = sanitiseCommandId(raw?.id)
  if (!id) return null
  const path = String(raw.path || '').trim()
  if (!path || /[\0]/.test(path)) return null
  const command =
    String(raw.command || '')
      .trim()
      .slice(0, 64) ||
    path
      .replace(/\\/g, '/')
      .split('/')
      .pop()
      ?.replace(/\.(exe|cmd|bat|ps1)$/i, '') ||
    id
  const providerId = String(raw.providerId || 'console-command').trim() || 'console-command'
  return {
    id,
    command: command.slice(0, 64),
    path: path.slice(0, 1024),
    providerId: providerId.slice(0, 64),
    flags: Array.isArray(raw.flags)
      ? raw.flags.map(String).map((s) => s.trim()).filter(Boolean).slice(0, 64)
      : typeof raw.flags === 'string'
        ? raw.flags
            .split(/\s+/)
            .map((s: string) => s.trim())
            .filter(Boolean)
            .slice(0, 64)
        : [],
  }
}

export function loadCommands(): CommandsStore {
  const file = commandsFile()
  let raw: string
  try {
    raw = readTextFileSync(file)
  } catch {
    return emptyStore()
  }
  try {
    const data = JSON.parse(raw)
    if (!data || !Array.isArray(data.commands)) return emptyStore()
    return {
      version: data.version || COMMANDS_VERSION,
      commands: data.commands.map(normaliseCommand).filter(Boolean) as CustomCommand[],
    }
  } catch {
    console.warn(`[dev-team-dashboard] commands.json corrupt: ${file}`)
    return emptyStore()
  }
}

export function saveCommands(store: CommandsStore): CommandsStore {
  const home = registryHome()
  mkdirSync(home, { recursive: true })
  const file = commandsFile()
  const tmp = `${file}.tmp`
  const payload = JSON.stringify(
    {
      version: store.version || COMMANDS_VERSION,
      commands: store.commands || [],
    },
    null,
    2,
  )
  writeTextFileSync(tmp, payload)
  renameSync(tmp, file)
  return store
}

export function listCustomCommands(): CustomCommand[] {
  return loadCommands().commands
}

export function getCustomCommand(id: unknown): CustomCommand | null {
  const clean = sanitiseCommandId(id)
  if (!clean) return null
  return loadCommands().commands.find((c) => c.id === clean) || null
}

export function upsertCustomCommand(input: any): MutationResult<{ command: CustomCommand }> {
  const entry = normaliseCommand(input)
  if (!entry) return { ok: false, error: 'invalid command (id and path required)' }
  if (!entry.path) return { ok: false, error: 'path is required' }

  const store = loadCommands()
  const idx = store.commands.findIndex((c) => c.id === entry.id)
  if (idx >= 0) store.commands[idx] = entry
  else store.commands.push(entry)
  saveCommands(store)
  return { ok: true, command: entry }
}

export function deleteCustomCommand(id: unknown): MutationResult {
  const clean = sanitiseCommandId(id)
  if (!clean) return { ok: false, status: 400, error: 'invalid id' }
  const store = loadCommands()
  const idx = store.commands.findIndex((c) => c.id === clean)
  if (idx < 0) return { ok: false, status: 404, error: 'not found' }
  store.commands.splice(idx, 1)
  saveCommands(store)
  return { ok: true }
}
