import { load, save } from './storage'
import type { ExportPreference } from './types'

export interface Settings {
  clientId: string
  exportPref: ExportPreference
  concurrency: number
}

const KEY = 'cosmos.settings'

export function loadSettings(): Settings {
  const stored = load<Partial<Settings>>(KEY, {})
  return {
    clientId: stored.clientId || import.meta.env.VITE_GOOGLE_CLIENT_ID || '',
    exportPref: stored.exportPref ?? 'office',
    concurrency: stored.concurrency ?? 3,
  }
}

export function saveSettings(s: Settings): void {
  save(KEY, s)
}
