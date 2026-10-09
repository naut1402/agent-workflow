// xem docs/architecture/code/backend.md §2
import * as childProcess from 'node:child_process'
import type {
  ChildProcess,
  SpawnOptions,
  SpawnSyncOptions,
  SpawnSyncReturns,
} from 'node:child_process'

export type { ChildProcess, SpawnOptions, SpawnSyncOptions, SpawnSyncReturns }

/** `child_process.spawn`. */
export function spawn(
  command: string,
  args: ReadonlyArray<string>,
  options?: SpawnOptions,
): ChildProcess {
  return childProcess.spawn(command, args as string[], options)
}

/** `child_process.spawnSync`. */
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
