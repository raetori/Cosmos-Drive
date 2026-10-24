import { FOLDER_MIME, SHORTCUT_MIME, type ExportPreference } from './types'

const GOOGLE_APPS = 'application/vnd.google-apps.'

/** Google Docs-type files have no bytes of their own and must be exported. */
const EXPORTS: Record<string, { office: [string, string]; pdf: [string, string] }> = {
  [GOOGLE_APPS + 'document']: {
    office: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', '.docx'],
    pdf: ['application/pdf', '.pdf'],
  },
  [GOOGLE_APPS + 'spreadsheet']: {
    office: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '.xlsx'],
    pdf: ['application/pdf', '.pdf'],
  },
  [GOOGLE_APPS + 'presentation']: {
    office: ['application/vnd.openxmlformats-officedocument.presentationml.presentation', '.pptx'],
    pdf: ['application/pdf', '.pdf'],
  },
  [GOOGLE_APPS + 'drawing']: {
    office: ['image/png', '.png'],
    pdf: ['application/pdf', '.pdf'],
  },
  [GOOGLE_APPS + 'script']: {
    office: ['application/vnd.google-apps.script+json', '.json'],
    pdf: ['application/vnd.google-apps.script+json', '.json'],
  },
  [GOOGLE_APPS + 'jam']: {
    office: ['application/pdf', '.pdf'],
    pdf: ['application/pdf', '.pdf'],
  },
}

export function isFolder(mimeType: string): boolean {
  return mimeType === FOLDER_MIME
}

export function isGoogleApp(mimeType: string): boolean {
  return mimeType.startsWith(GOOGLE_APPS) && mimeType !== FOLDER_MIME && mimeType !== SHORTCUT_MIME
}

/** Returns the export MIME type and extension, or null when Drive cannot export this type. */
export function exportFor(mimeType: string, pref: ExportPreference): { mime: string; ext: string } | null {
  const entry = EXPORTS[mimeType]
  if (!entry) return null
  const [mime, ext] = entry[pref]
  return { mime, ext }
}

const RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i

/** Makes a Drive name safe as a file name on macOS, Windows and Linux. */
export function sanitizeName(name: string): string {
  let out = name
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[/\\:*?"<>|]/g, '_')
    .replace(/[. ]+$/, '')
    .trim()
  if (!out || out === '.' || out === '..') out = '_'
  if (RESERVED.test(out)) out = '_' + out
  if (out.length > 200) {
    const dot = out.lastIndexOf('.')
    const ext = dot > 0 && out.length - dot <= 10 ? out.slice(dot) : ''
    out = out.slice(0, 200 - ext.length) + ext
  }
  return out
}

/**
 * Drive allows several files with the same name in one folder; a disk does not.
 * Hands out unique names per folder: "a.txt", "a (2).txt", "a (3).txt".
 */
export class NameAllocator {
  private used = new Map<string, Set<string>>()

  claim(folderPath: string, name: string): string {
    let set = this.used.get(folderPath)
    if (!set) {
      set = new Set()
      this.used.set(folderPath, set)
    }
    const dot = name.lastIndexOf('.')
    const base = dot > 0 ? name.slice(0, dot) : name
    const ext = dot > 0 ? name.slice(dot) : ''
    let candidate = name
    for (let n = 2; set.has(candidate.toLowerCase()); n++) candidate = `${base} (${n})${ext}`
    set.add(candidate.toLowerCase())
    return candidate
  }
}

/** Appends an export extension unless the name already ends with it. */
export function withExtension(name: string, ext: string): string {
  return name.toLowerCase().endsWith(ext) ? name : name + ext
}

/** Pulls a file or folder id out of any common Google Drive link, or accepts a bare id. */
export function parseDriveLink(input: string): string | null {
  const text = input.trim()
  if (/^[\w-]{10,}$/.test(text)) return text
  const patterns = [/\/folders\/([\w-]{10,})/, /\/file\/d\/([\w-]{10,})/, /\/d\/([\w-]{10,})/, /[?&]id=([\w-]{10,})/]
  for (const p of patterns) {
    const m = text.match(p)
    if (m) return m[1]
  }
  return null
}

export function formatBytes(bytes?: number): string {
  if (bytes === undefined || Number.isNaN(bytes)) return '—'
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let v = bytes / 1024
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${v.toFixed(v < 10 ? 1 : 0)} ${units[i]}`
}

export function formatDate(iso?: string): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '—'
  if (seconds < 60) return `${Math.ceil(seconds)}s`
  const m = Math.floor(seconds / 60)
  if (m < 60) return `${m}m ${Math.round(seconds % 60)}s`
  return `${Math.floor(m / 60)}h ${m % 60}m`
}

/** Human label for a MIME type, for the Kind column. */
export function kindOf(mimeType: string): string {
  if (isFolder(mimeType)) return 'Folder'
  const map: Record<string, string> = {
    [GOOGLE_APPS + 'document']: 'Google Doc',
    [GOOGLE_APPS + 'spreadsheet']: 'Google Sheet',
    [GOOGLE_APPS + 'presentation']: 'Google Slides',
    [GOOGLE_APPS + 'drawing']: 'Google Drawing',
    [GOOGLE_APPS + 'form']: 'Google Form',
    [GOOGLE_APPS + 'script']: 'Apps Script',
    'application/pdf': 'PDF',
    'application/zip': 'Zip archive',
  }
  if (map[mimeType]) return map[mimeType]
  const [type, sub] = mimeType.split('/')
  if (type === 'image') return 'Image'
  if (type === 'video') return 'Video'
  if (type === 'audio') return 'Audio'
  if (type === 'text') return 'Text'
  return sub ? sub.replace(/^(x-|vnd\.)/, '').split(/[.+]/)[0].toUpperCase() : 'File'
}
