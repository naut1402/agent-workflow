/**
 * Thin wrappers around `node:child_process`.
 *
 * Namespace import — named `from 'node:child_process'` is rewritten by Vite to
 * property access at module init (`ext["spawnSync"]`), which throws if a
 * server-only module leaks into the client graph. Defer access to call sites.
 */
import * as childProcess from 'node:child_process'
import type {
  ChildProcess,
  SpawnOptions,
  SpawnSyncOptions,
  SpawnSyncReturns,
} from 'node:child_process'

export type { ChildProcess, SpawnOptions, SpawnSyncOptions, SpawnSyncReturns }

/** `child_process.spawn` — deferred so Vite client external stubs do not throw at import. */
export function spawn(
  command: string,
  args: ReadonlyArray<string>,
  options?: SpawnOptions,
): ChildProcess {
  return childProcess.spawn(command, args as string[], options)
}

/** `child_process.spawnSync` — deferred (same Vite rationale as `spawn`). */
export function spawnSync(
  command: string,
  args: ReadonlyArray<string>,
  options: SpawnSyncOptions & { encoding: BufferEncoding },
): SpawnSyncReturns<string>
export function spawnSync(
  command: string,
  args: ReadonlyArray<string>,
  options?: SpawnSyncOptions,
): SpawnSyncReturns<string | Buffer>
export function spawnSync(
  command: string,
  args: ReadonlyArray<string>,
  options?: SpawnSyncOptions,
): SpawnSyncReturns<string | Buffer> {
  return childProcess.spawnSync(command, args as string[], options)
}
