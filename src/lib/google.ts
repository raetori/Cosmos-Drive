// Google sign-in (Google Identity Services) and the Drive API v3 client.

import { FOLDER_MIME, SHORTCUT_MIME, type Account, type DriveItem, type DriveSource } from './types'

export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.readonly'
const API = 'https://www.googleapis.com/drive/v3'
const FIELDS = 'id,name,mimeType,size,md5Checksum,modifiedTime,driveId,iconLink,shortcutDetails,resourceKey'

export const VIRTUAL = {
  myDrive: '@my-drive',
  sharedDrives: '@shared-drives',
  sharedWithMe: '@shared-with-me',
} as const

export function virtualRoots(): DriveItem[] {
  return [
    { id: VIRTUAL.myDrive, name: 'My Drive', mimeType: FOLDER_MIME, virtual: true },
    { id: VIRTUAL.sharedDrives, name: 'Shared drives', mimeType: FOLDER_MIME, virtual: true },
    { id: VIRTUAL.sharedWithMe, name: 'Shared with me', mimeType: FOLDER_MIME, virtual: true },
  ]
}

// ---------------------------------------------------------------------------
// Sign-in

interface TokenResponse {
  access_token?: string
  expires_in?: number
  error?: string
  error_description?: string
}

interface TokenClient {
  requestAccessToken(overrides?: { prompt?: string; login_hint?: string }): void
}

declare global {
  interface Window {
    google?: {
      accounts: {
        oauth2: {
          initTokenClient(config: {
            client_id: string
            scope: string
            prompt?: string
            login_hint?: string
            callback: (r: TokenResponse) => void
            error_callback?: (e: { type: string; message?: string }) => void
          }): TokenClient
          revoke(token: string, done?: () => void): void
        }
      }
    }
  }
}

let gisLoading: Promise<void> | null = null

function loadGis(): Promise<void> {
  if (window.google?.accounts) return Promise.resolve()
  gisLoading ??= new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = 'https://accounts.google.com/gsi/client'
    s.async = true
    s.onload = () => resolve()
    s.onerror = () => {
      gisLoading = null
      reject(new Error('Could not load Google sign-in. Check your connection or ad blocker.'))
    }
    document.head.appendChild(s)
  })
  return gisLoading
}

export interface Token {
  accessToken: string
  expiresAt: number
}

/**
 * The person closed Google's popup. Google doesn't say why, but while the app is in
 * testing the usual reason is "Access blocked" for an account that isn't a test user.
 */
export class SignInClosed extends Error {
  constructor() {
    super('Sign-in was closed. If Google said “Access blocked”, that account isn’t on our beta list yet.')
    this.name = 'SignInClosed'
  }
}

/** Opens Google's consent popup. Must be called from a click handler so the popup isn't blocked. */
export async function requestToken(clientId: string, loginHint?: string): Promise<Token> {
  await loadGis()
  return new Promise((resolve, reject) => {
    const client = window.google!.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: DRIVE_SCOPE,
      callback: (r) => {
        if (r.error || !r.access_token) {
          reject(new Error(r.error_description || r.error || 'Sign-in failed'))
          return
        }
        resolve({ accessToken: r.access_token, expiresAt: Date.now() + (r.expires_in ?? 3600) * 1000 })
      },
      error_callback: (e) => reject(e.type === 'popup_closed' ? new SignInClosed() : new Error(e.message || e.type)),
    })
    client.requestAccessToken(loginHint ? { prompt: '', login_hint: loginHint } : { prompt: 'select_account' })
  })
}

export function revokeToken(token: string): void {
  window.google?.accounts.oauth2.revoke(token)
}

export async function fetchAccount(accessToken: string): Promise<Account> {
  const r = await fetch(`${API}/about?fields=user(displayName,emailAddress,photoLink)`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!r.ok) throw new Error(`Could not read your Google profile (${r.status})`)
  const { user } = await r.json()
  return { id: user.emailAddress, email: user.emailAddress, name: user.displayName, photo: user.photoLink }
}

// ---------------------------------------------------------------------------
// Drive API

export class DriveError extends Error {
  status: number
  reason?: string
  constructor(status: number, message: string, reason?: string) {
    super(message)
    this.status = status
    this.reason = reason
  }
}

const RETRYABLE_REASONS = new Set(['rateLimitExceeded', 'userRateLimitExceeded', 'backendError', 'internalError'])

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => {
      clearTimeout(t)
      reject(signal.reason ?? new DOMException('Aborted', 'AbortError'))
    }, { once: true })
  })
}

async function readError(r: Response): Promise<DriveError> {
  let message = `${r.status} ${r.statusText}`
  let reason: string | undefined
  try {
    const body = await r.json()
    message = body.error?.message ?? message
    reason = body.error?.errors?.[0]?.reason ?? body.error?.status
  } catch {
    // Non-JSON error body; keep the status line.
  }
  return new DriveError(r.status, message, reason)
}

function escapeQuery(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
}

export interface TokenProvider {
  /** A currently valid access token. */
  get(): Promise<string>
  /** Called after a 401; resolves with a fresh token once the user has signed in again. */
  renew(): Promise<string>
}

export class GoogleDriveSource implements DriveSource {
  account: Account
  private tokens: TokenProvider

  constructor(account: Account, tokens: TokenProvider) {
    this.account = account
    this.tokens = tokens
  }

  /** Fetch with auth, plus retries for rate limits, server errors and dropped connections. */
  private async request(url: string, signal?: AbortSignal, headers: Record<string, string> = {}): Promise<Response> {
    let token = await this.tokens.get()
    let renewed = false
    for (let attempt = 0; ; attempt++) {
      let r: Response
      try {
        r = await fetch(url, { headers: { ...headers, Authorization: `Bearer ${token}` }, signal })
      } catch (e) {
        if (signal?.aborted || attempt >= 5) throw e
        await sleep(backoff(attempt), signal)
        continue
      }
      if (r.ok) return r
      if (r.status === 401 && !renewed) {
        token = await this.tokens.renew()
        renewed = true
        continue
      }
      const err = await readError(r)
      const retryable = r.status === 429 || r.status >= 500 || (r.status === 403 && RETRYABLE_REASONS.has(err.reason ?? ''))
      if (!retryable || attempt >= 6) throw err
      await sleep(backoff(attempt), signal)
    }
  }

  private async json<T>(url: string, signal?: AbortSignal, headers?: Record<string, string>): Promise<T> {
    return (await this.request(url, signal, headers)).json()
  }

  private async listQuery(params: Record<string, string>, signal?: AbortSignal, headers?: Record<string, string>): Promise<DriveItem[]> {
    const out: DriveItem[] = []
    let pageToken: string | undefined
    do {
      const qs = new URLSearchParams({
        pageSize: '1000',
        fields: `nextPageToken,files(${FIELDS})`,
        supportsAllDrives: 'true',
        includeItemsFromAllDrives: 'true',
        ...params,
      })
      if (pageToken) qs.set('pageToken', pageToken)
      const page = await this.json<{ files: RawFile[]; nextPageToken?: string }>(`${API}/files?${qs}`, signal, headers)
      out.push(...page.files.map(toItem))
      pageToken = page.nextPageToken
    } while (pageToken)
    return this.resolveShortcuts(out, signal)
  }

  /** Replaces shortcuts with their targets so they browse and download like the real thing. */
  private async resolveShortcuts(items: DriveItem[], signal?: AbortSignal): Promise<DriveItem[]> {
    return Promise.all(
      items.map(async (item) => {
        if (item.mimeType !== SHORTCUT_MIME || !item.shortcutTarget) return item
        try {
          const target = await this.get(item.shortcutTarget, signal, item.shortcutTargetKey)
          return { ...target, name: item.name, shortcutOf: item.id }
        } catch {
          return item // Target deleted or not shared with us; leave the shortcut so it's reported as skipped.
        }
      }),
    )
  }

  async list(folder: DriveItem, signal?: AbortSignal): Promise<DriveItem[]> {
    if (folder.id === VIRTUAL.myDrive) {
      return this.listQuery({ q: "'root' in parents and trashed = false", orderBy: 'folder,name_natural' }, signal)
    }
    if (folder.id === VIRTUAL.sharedWithMe) {
      return this.listQuery({ q: 'sharedWithMe and trashed = false', orderBy: 'folder,name_natural' }, signal)
    }
    if (folder.id === VIRTUAL.sharedDrives) {
      const out: DriveItem[] = []
      let pageToken: string | undefined
      do {
        const qs = new URLSearchParams({ pageSize: '100', fields: 'nextPageToken,drives(id,name)' })
        if (pageToken) qs.set('pageToken', pageToken)
        const page = await this.json<{ drives: { id: string; name: string }[]; nextPageToken?: string }>(`${API}/drives?${qs}`, signal)
        out.push(...page.drives.map((d) => ({ id: d.id, name: d.name, mimeType: FOLDER_MIME, driveId: d.id })))
        pageToken = page.nextPageToken
      } while (pageToken)
      return out
    }
    const q = `'${escapeQuery(folder.id)}' in parents and trashed = false`
    const scope: Record<string, string> = folder.driveId ? { corpora: 'drive', driveId: folder.driveId } : {}
    return this.listQuery({ q, orderBy: 'folder,name_natural', ...scope }, signal, keyHeader(folder.id, folder.resourceKey))
  }

  async get(id: string, signal?: AbortSignal, resourceKey?: string): Promise<DriveItem> {
    const url = `${API}/files/${encodeURIComponent(id)}?fields=${FIELDS}&supportsAllDrives=true`
    return toItem(await this.json<RawFile>(url, signal, keyHeader(id, resourceKey)))
  }

  async search(text: string, signal?: AbortSignal): Promise<DriveItem[]> {
    return this.listQuery({ q: `name contains '${escapeQuery(text)}' and trashed = false`, corpora: 'allDrives' }, signal)
  }

  async open(item: DriveItem, exportMime: string | null, signal?: AbortSignal, from = 0): Promise<Response> {
    const id = encodeURIComponent(item.id)
    const key = keyHeader(item.id, item.resourceKey)
    if (exportMime) {
      return this.request(`${API}/files/${id}/export?mimeType=${encodeURIComponent(exportMime)}`, signal, key)
    }
    // A start offset resumes a download that dropped partway through.
    const range: Record<string, string> = { ...key, ...(from ? { Range: `bytes=${from}-` } : {}) }
    // Files Google flags as malware fail with cannotDownloadAbusiveFile; we report them
    // rather than silently passing acknowledgeAbuse.
    return this.request(`${API}/files/${id}?alt=media&supportsAllDrives=true`, signal, range)
  }
}

/**
 * Files shared by link before Google's 2021 security update need their resource key (the
 * `resourcekey=` part of the link) sent with every request, or Drive answers 404.
 */
function keyHeader(id: string, resourceKey?: string): Record<string, string> {
  return resourceKey ? { 'X-Goog-Drive-Resource-Keys': `${id}/${resourceKey}` } : {}
}

function backoff(attempt: number): number {
  return Math.min(32_000, 1000 * 2 ** attempt) + Math.random() * 1000
}

interface RawFile {
  id: string
  name: string
  mimeType: string
  size?: string
  md5Checksum?: string
  modifiedTime?: string
  driveId?: string
  iconLink?: string
  shortcutDetails?: { targetId: string; targetMimeType: string; targetResourceKey?: string }
  resourceKey?: string
}

function toItem(f: RawFile): DriveItem {
  return {
    id: f.id,
    name: f.name,
    mimeType: f.mimeType,
    size: f.size !== undefined ? Number(f.size) : undefined,
    md5: f.md5Checksum,
    modifiedTime: f.modifiedTime,
    driveId: f.driveId,
    iconLink: f.iconLink,
    shortcutTarget: f.shortcutDetails?.targetId,
    shortcutTargetKey: f.shortcutDetails?.targetResourceKey,
    resourceKey: f.resourceKey,
  }
}
