// Turns Drive and file-system errors into plain explanations and decides how to react.

import { DriveError } from './google'
import { FolderNameError } from './localfs'

export interface Explained {
  message: string
  /** Google will refuse this file for a while; retrying now is pointless. */
  later?: boolean
  /** Nothing else in this transfer can succeed either (disk full, folder access lost). */
  fatal?: boolean
}

const DRIVE_REASONS: Record<string, Explained> = {
  downloadQuotaExceeded: {
    message: 'Google has locked this shared file for a while because it was downloaded too often. Try again in about 24 hours.',
    later: true,
  },
  cannotDownloadFile: { message: 'The owner turned off downloading for this file, so nobody can download it, even from Google Drive. Ask them to allow downloads.' },
  cannotDownloadAbusiveFile: { message: 'Google flagged this file as malware or abuse and blocks downloading it.' },
  exportSizeLimitExceeded: {
    message: 'This Google Doc is too large for Google to export (about 10 MB). Open it in Google Docs and use File → Download.',
  },
  cannotExportFile: { message: 'Google Drive can’t export this file.' },
  insufficientFilePermissions: { message: 'Your account no longer has access to this file.' },
  appNotAuthorizedToFile: { message: 'Your account no longer has access to this file.' },
  notFound: { message: 'The file was deleted or moved in Drive after the copy started.' },
}

export function explain(e: unknown): Explained {
  if (e instanceof DriveError) {
    const known = e.reason && DRIVE_REASONS[e.reason]
    if (known) return known
    if (e.status === 404) return DRIVE_REASONS.notFound
    if (e.status === 429 || e.status >= 500) return { message: `Google Drive is busy (${e.status}). Retry later.`, later: true }
    return { message: e.message }
  }
  if (e instanceof DOMException) {
    if (e.name === 'QuotaExceededError') return { message: 'Your disk is full. Free up space, then press Resume.', fatal: true }
    if (e.name === 'NotAllowedError') return { message: 'We lost permission to write to that folder. Press Resume and allow access again.', fatal: true }
    if (e.name === 'NotFoundError') return { message: 'The destination folder was moved or deleted.', fatal: true }
  }
  if (e instanceof ChecksumError || e instanceof FolderNameError) return { message: e.message }
  if (e instanceof TypeError) return { message: 'The connection dropped while downloading.', later: true }
  return { message: e instanceof Error ? e.message : String(e) }
}

/** The bytes that arrived don't match the fingerprint Google Drive has for the file. */
export class ChecksumError extends Error {
  constructor() {
    super('The downloaded bytes didn’t match Google Drive’s checksum, so the file was corrupted on the way. Retried, still wrong.')
  }
}
