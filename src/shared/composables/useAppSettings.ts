import { ref, type Ref } from 'vue'
import {
  DEFAULT_APP_SETTINGS,
  parseAppSettings,
  type AppSettings,
} from '../../../shared/schemas/appSettings'

export const STORAGE_KEY = 'dev-dashboard-app-settings'

const settings: Ref<AppSettings> = ref({ ...DEFAULT_APP_SETTINGS })
let loaded = false

function load(): void {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw == null) {
      settings.value = { ...DEFAULT_APP_SETTINGS }
      return
    }
    settings.value = parseAppSettings(JSON.parse(raw))
  } catch {
    settings.value = { ...DEFAULT_APP_SETTINGS }
  }
}

function persist(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings.value))
  } catch {
    /* ignore — private mode / quota */
  }
}

function update(patch: Partial<AppSettings>): void {
  settings.value = { ...settings.value, ...patch }
  persist()
}

/** Shared client preference store (singleton across callers). */
export function useAppSettings() {
  if (!loaded) {
    load()
    loaded = true
  }
  return { settings, load, persist, update }
}
