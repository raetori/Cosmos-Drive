// Walks a selection of Drive items and turns it into a flat list of files to write.

import { NameAllocator, exportFor, isFolder, isGoogleApp, sanitizeName, withExtension } from './paths'
import { SHORTCUT_MIME, type DriveItem, type DriveSource, type ExportPreference, type PlannedFile, type ReportEntry } from './types'

export interface Plan {
  /** Every folder path, parents before children, so empty folders are recreated too. */
  folders: string[]
  files: PlannedFile[]
  /** Items Google Drive can't provide; reported, never downloaded. */
  skipped: ReportEntry[]
  /** Sum of known file sizes. Google Docs exports are not included until downloaded. */
  bytes: number
}

export interface PlanOptions {
  exportPref: ExportPreference
  signal?: AbortSignal
  /** Folders listed in parallel. */
  concurrency?: number
  onProgress?: (files: number, bytes: number) => void
}

export async function planTransfer(source: DriveSource, roots: DriveItem[], opts: PlanOptions): Promise<Plan> {
  const plan: Plan = { folders: [], files: [], skipped: [], bytes: 0 }
  const names = new NameAllocator()
  const visited = new Set<string>()
  const queue: { item: DriveItem; path: string }[] = []
  // Shortcuts to folders wait until every real folder has been walked, so a folder
  // that is both in the selection and shortcut to lands at its real location.
  let deferred: { item: DriveItem; parentPath: string }[] = []

  const add = (item: DriveItem, parentPath: string, viaShortcut = false) => {
    const join = (name: string) => (parentPath ? `${parentPath}/${name}` : name)
    const safe = sanitizeName(item.name)

    if (isFolder(item.mimeType)) {
      if (item.shortcutOf && !viaShortcut) {
        deferred.push({ item, parentPath })
        return
      }
      // A shortcut can lead back to a folder already in the download, even an ancestor.
      if (visited.has(item.id)) {
        plan.skipped.push({ path: join(safe), outcome: 'skipped', detail: 'Shortcut to a folder that is already in this download; copied once' })
        return
      }
      visited.add(item.id)
      const path = join(names.claim(parentPath, safe))
      plan.folders.push(path)
      queue.push({ item, path })
      return
    }
    if (item.mimeType === SHORTCUT_MIME) {
      plan.skipped.push({ path: join(safe), outcome: 'skipped', detail: 'Shortcut points to a file that is missing or not shared with you' })
      return
    }
    if (isGoogleApp(item.mimeType)) {
      const exp = exportFor(item.mimeType, opts.exportPref)
      if (!exp) {
        plan.skipped.push({ path: join(safe), outcome: 'skipped', detail: 'Google Drive cannot export this type (Forms, Sites, My Maps)' })
        return
      }
      const path = join(names.claim(parentPath, withExtension(safe, exp.ext)))
      plan.files.push({ item, path, exportMime: exp.mime })
      return
    }
    const path = join(names.claim(parentPath, safe))
    plan.files.push({ item, path, exportMime: null, size: item.size })
    plan.bytes += item.size ?? 0
  }

  for (const root of roots) add(root, '')
  opts.onProgress?.(plan.files.length, plan.bytes)

  // List folders a few at a time. Each folder's children are named in one go, so
  // duplicate-name numbering is the same on every run (resuming a copy relies on that).
  const concurrency = opts.concurrency ?? 4
  const drain = () => new Promise<void>((resolve, reject) => {
    let active = 0
    let failed = false
    const pump = () => {
      if (failed) return
      while (active < concurrency && queue.length) {
        const next = queue.shift()!
        active++
        source.list(next.item, opts.signal).then(
          (children) => {
            active--
            children.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
            for (const child of children) add(child, next.path)
            opts.onProgress?.(plan.files.length, plan.bytes)
            pump()
          },
          (e) => {
            failed = true
            reject(e)
          },
        )
      }
      if (!active && !queue.length) resolve()
    }
    pump()
  })

  await drain()
  while (deferred.length) {
    const batch = deferred
    deferred = []
    for (const d of batch) add(d.item, d.parentPath, true)
    await drain()
  }

  plan.folders.sort()
  plan.files.sort((a, b) => a.path.localeCompare(b.path))
  return plan
}

/** A smaller plan holding only the given paths, for re-downloading what a check flagged. */
export function subsetPlan(plan: Plan, paths: Set<string>): Plan {
  const files = plan.files.filter((f) => paths.has(f.path))
  const folders = plan.folders.filter((d) => files.some((f) => f.path.startsWith(d + '/')))
  return { folders, files, skipped: [], bytes: files.reduce((n, f) => n + (f.size ?? 0), 0) }
}
