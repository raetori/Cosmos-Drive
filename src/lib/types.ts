// Shared shapes for Drive items, sources and transfers.

export const FOLDER_MIME = 'application/vnd.google-apps.folder'
export const SHORTCUT_MIME = 'application/vnd.google-apps.shortcut'

/** A file or folder as CosmoDrive sees it. Virtual roots use ids like `@my-drive`. */
export interface DriveItem {
  id: string
  name: string
  mimeType: string
  size?: number
  /** Drive's MD5 of the file's bytes. Google Docs-type files have none. */
  md5?: string
  modifiedTime?: string
  /** Set on items that live in a shared drive. */
  driveId?: string
  /** Set when the item is a shortcut that we resolved to its target. */
  shortcutOf?: string
  /** Set on a shortcut we could not resolve: the id it points to. */
  shortcutTarget?: string
  /** The shortcut target's resource key, if it has one. */
  shortcutTargetKey?: string
  /** Older link-shared files need this key (from the link or from Drive) to be opened. */
  resourceKey?: string
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
  get(id: string, signal?: AbortSignal, resourceKey?: string): Promise<DriveItem>
  search(text: string, signal?: AbortSignal): Promise<DriveItem[]>
  /**
   * Opens a byte stream for a binary file, or an export for a Google Docs-type file.
   * `from` resumes a binary file at that byte; the response must then be 206.
   */
  open(item: DriveItem, exportMime: string | null, signal?: AbortSignal, from?: number): Promise<Response>
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

/**
 * What happened to one file, as shown in the verification report.
 * - verified: on disk and its bytes match Google Drive's MD5 checksum
 * - saved: on disk at the expected size; Drive has no checksum for it (Google Docs exports)
 * - reused: was already on disk at the right size, so it wasn't downloaded again
 * - missing / different: found by a check: not on disk, or not the same as in Drive
 * - failed: could not be downloaded (reason in `detail`)
 * - later: Google refused it for now (quota lock, busy); retry later
 * - skipped: Google Drive can't provide this item at all (Forms, Sites, broken shortcuts)
 * - extra: on disk but not in Drive (informational)
 */
export type Outcome = 'verified' | 'saved' | 'reused' | 'missing' | 'different' | 'failed' | 'later' | 'skipped' | 'extra'

export interface ReportEntry {
  path: string
  outcome: Outcome
  detail?: string
  size?: number
}

/** Outcomes that need the user's attention, and that "Fix" downloads again. */
export const PROBLEMS: Outcome[] = ['missing', 'different', 'failed', 'later']

export type TransferMode = 'folder' | 'zip' | 'verify'

export type TransferState = 'scanning' | 'running' | 'verifying' | 'done' | 'failed' | 'cancelled'

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
  /** One entry per file once it is settled, plus skipped and extra items. */
  report: ReportEntry[]
  /** Local folder the transfer wrote to or checked, for the report header. */
  destination?: string
  error?: string
  startedAt: number
  finishedAt?: number
}
