import { load, save } from './storage'
import type { ExportPreference } from './types'

export interface Settings {
  clientId: string
  exportPref: ExportPreference
  concurrency: number
}

const KEY = 'cosmos.settings'

/** The OAuth client ID shipped with the app. Only builds without one ask for an ID in Settings. */
export const BUILT_IN_CLIENT_ID: string = import.meta.env.VITE_GOOGLE_CLIENT_ID || ''

export function loadSettings(): Settings {
  const stored = load<Partial<Settings>>(KEY, {})
  return {
    clientId: stored.clientId || BUILT_IN_CLIENT_ID,
    exportPref: stored.exportPref ?? 'office',
    concurrency: stored.concurrency ?? 3,
  }
}

export function saveSettings(s: Settings): void {
  save(KEY, s)
}
