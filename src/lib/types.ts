// Shared shapes for Drive items, sources and transfers.

export const FOLDER_MIME = 'application/vnd.google-apps.folder'
export const SHORTCUT_MIME = 'application/vnd.google-apps.shortcut'

/** A file or folder as Cosmos Drive sees it. Virtual roots use ids like `@my-drive`. */
export interface DriveItem {
  id: string
  name: string
  mimeType: string
  size?: number
  modifiedTime?: string
  /** Set on items that live in a shared drive. */
  driveId?: string
  /** Set when the item is a shortcut that we resolved to its target. */
  shortcutOf?: string
  /** Set on a shortcut we could not resolve: the id it points to. */
  shortcutTarget?: string
  iconLink?: string
  /** Virtual nodes (My Drive, Shared drives, ...) can be browsed but not downloaded as a unit. */
  virtual?: boolean
}

export interface Account {
  /** Stable key: the Google account email, or `demo`. */
  id: string
  email: string
  name: string
  photo?: string
  demo?: boolean
}

/** A folder the user pasted a link to, pinned under an account in the sidebar. */
export interface LinkedFolder {
  accountId: string
  item: DriveItem
}

export interface ListResult {
  items: DriveItem[]
}

/**
 * Everything the browser and the transfer engine need from a storage backend.
 * The real Google Drive client and the demo source both implement it.
 */
export interface DriveSource {
  account: Account
  /** Children of a folder (or of a virtual root). Follows all pages. */
  list(folder: DriveItem, signal?: AbortSignal): Promise<DriveItem[]>
  get(id: string, signal?: AbortSignal): Promise<DriveItem>
  search(text: string, signal?: AbortSignal): Promise<DriveItem[]>
  /** Opens a byte stream for a binary file, or an export for a Google Docs-type file. */
  open(item: DriveItem, exportMime: string | null, signal?: AbortSignal): Promise<Response>
}

export type ExportPreference = 'office' | 'pdf'

/** One file the transfer engine will write, with its path relative to the destination. */
export interface PlannedFile {
  item: DriveItem
  path: string
  /** Export MIME type for Google Docs-type files, null for normal files. */
  exportMime: string | null
  /** Known size in bytes (exports have no size until downloaded). */
  size?: number
}

export interface SkippedFile {
  path: string
  reason: string
}

export type TransferMode = 'folder' | 'zip'

export type TransferState = 'scanning' | 'running' | 'paused' | 'done' | 'failed' | 'cancelled'

export interface TransferProgress {
  id: string
  mode: TransferMode
  label: string
  state: TransferState
  filesTotal: number
  filesDone: number
  bytesTotal: number
  bytesDone: number
  /** Files that already existed with the same size and were left alone. */
  filesReused: number
  current: string[]
  skipped: SkippedFile[]
  error?: string
  startedAt: number
  finishedAt?: number
}
