// Cross-checks what Google Drive has against what is actually in a folder on disk.

import { createMD5 } from 'hash-wasm'
import type { LocalTree } from './localfs'
import type { Plan } from './plan'
import type { ReportEntry } from './types'

export interface VerifyOptions {
  /** Read every file and compare its MD5 with Drive's. Otherwise only presence and size. */
  deep?: boolean
  /** Also list files on disk that aren't in Drive (off when checking only part of a plan). */
  extras?: boolean
  signal?: AbortSignal
  /** Called as files are checked; `bytes` counts bytes read for hashing. */
  onProgress?(files: number, bytes: number, current?: string): void
}

async function md5OfFile(file: File, signal?: AbortSignal, onBytes?: (n: number) => void): Promise<string> {
  const hasher = await createMD5()
  hasher.init()
  const reader = file.stream().getReader()
  for (;;) {
    signal?.throwIfAborted()
    const { done, value } = await reader.read()
    if (done) break
    hasher.update(value)
    onBytes?.(value.byteLength)
  }
  return hasher.digest('hex')
}

/**
 * Checks every file in the plan against the folder: present, right size and, with
 * `deep`, the same bytes as in Drive. Also lists files on disk that aren't in Drive.
 */
export async function verifyFolder(plan: Plan, tree: LocalTree, opts: VerifyOptions = {}): Promise<ReportEntry[]> {
  const report: ReportEntry[] = [...plan.skipped]
  let files = 0
  let bytes = 0

  for (const planned of plan.files) {
    opts.signal?.throwIfAborted()
    const local = await tree.file(planned.path)
    files++
    if (!local) {
      report.push({ path: planned.path, outcome: 'missing', detail: 'Not on your computer', size: planned.size })
    } else if (planned.size !== undefined && local.size !== planned.size) {
      report.push({
        path: planned.path,
        outcome: 'different',
        detail: `Size is ${local.size.toLocaleString()} bytes on disk but ${planned.size.toLocaleString()} in Drive (incomplete or changed)`,
        size: planned.size,
      })
    } else if (opts.deep && planned.item.md5 && !planned.exportMime) {
      opts.onProgress?.(files, bytes, planned.path)
      const hash = await md5OfFile(local, opts.signal, (n) => {
        bytes += n
        opts.onProgress?.(files, bytes, planned.path)
      })
      report.push(
        hash === planned.item.md5
          ? { path: planned.path, outcome: 'verified', size: local.size }
          : { path: planned.path, outcome: 'different', detail: 'Same size, but the bytes differ from Drive (corrupted or edited)', size: local.size },
      )
    } else {
      // Google Docs exports have no checksum, and their size isn't known before export.
      report.push({ path: planned.path, outcome: 'saved', size: local.size })
    }
    opts.onProgress?.(files, bytes)
  }

  if (opts.extras === false) return report
  const expected = new Set(plan.files.map((f) => f.path))
  for await (const { path, file } of tree.walk(plan)) {
    if (!expected.has(path)) report.push({ path, outcome: 'extra', detail: 'On your computer but not in Drive', size: file.size })
  }
  return report
}

const CSV_HEADER = ['Path', 'Result', 'Size (bytes)', 'Details']

const LABELS: Record<ReportEntry['outcome'], string> = {
  verified: 'Verified (checksum match)',
  saved: 'Saved (no checksum from Drive)',
  reused: 'Already on disk',
  missing: 'Missing',
  different: 'Different from Drive',
  failed: 'Failed',
  later: 'Retry later',
  skipped: 'Skipped by Google Drive',
  extra: 'Extra (not in Drive)',
}

export function outcomeLabel(o: ReportEntry['outcome']): string {
  return LABELS[o]
}

/** The report as CSV, ready for Excel, Numbers or Google Sheets. */
export function reportCsv(report: ReportEntry[]): string {
  const cell = (v: string | number | undefined) => {
    let s = v === undefined ? '' : String(v)
    // Spreadsheets run cells starting with these as formulas; a file name must stay text.
    if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = "'" + s
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const rows = report.map((r) => [r.path, LABELS[r.outcome], r.size, r.detail].map(cell).join(','))
  return [CSV_HEADER.join(','), ...rows].join('\r\n') + '\r\n'
}
