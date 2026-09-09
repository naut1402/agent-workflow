import { apiGet } from '../../../core/http/client'

/** Folder picker only — project registry FE API is in monitor. */
export async function browseFs(dirPath?: string) {
  return apiGet('/api/fs/browse', { path: dirPath ?? '' })
}
