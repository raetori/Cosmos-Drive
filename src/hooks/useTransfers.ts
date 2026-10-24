import { useCallback, useEffect, useRef, useState } from 'react'
import { lineUp, type LocalTree } from '../lib/localfs'
import { planTransfer, subsetPlan } from '../lib/plan'
import type { Settings } from '../lib/settings'
import { copyToFolder, writeZip, type TransferEvents } from '../lib/transfer'
import { PROBLEMS, type DriveItem, type DriveSource, type Outcome, type ReportEntry, type TransferMode, type TransferProgress } from '../lib/types'
import { verifyFolder } from '../lib/verify'

export type Target =
  | { kind: 'folder'; tree: LocalTree }
  | { kind: 'zip'; out: WritableStream<Uint8Array> }
  /** Check a folder already on disk. The tree is lined up with the selection once the plan is known. */
  | { kind: 'verify'; dir: FileSystemDirectoryHandle; tree?: LocalTree }

interface Job {
  progress: TransferProgress
  source: DriveSource
  roots: DriveItem[]
  target: Target
  /** Only these paths (a "fix" run); `force` re-downloads them even at the right size. */
  only?: Set<string>
  force?: Set<string>
  controller: AbortController
  /** Recent (time, bytesDone) samples for the speed readout. */
  samples: [number, number][]
}

export interface TransferView extends TransferProgress {
  bytesPerSecond: number
  counts: Partial<Record<Outcome, number>>
  /** Files that need attention: missing, different, failed or locked for later. */
  problems: number
  /** Copies into a folder can be started again and skip what is already there. */
  resumable: boolean
  /** There is a folder on disk to re-check or repair. */
  local: boolean
}

let nextId = 1

function count(report: ReportEntry[]): Partial<Record<Outcome, number>> {
  const out: Partial<Record<Outcome, number>> = {}
  for (const r of report) out[r.outcome] = (out[r.outcome] ?? 0) + 1
  return out
}

/**
 * Combines what the copy recorded with a check of the folder afterwards. The check wins
 * when it finds a file missing or different, unless the copy already knows why.
 */
function merge(copy: ReportEntry[], check: ReportEntry[]): ReportEntry[] {
  const byPath = new Map(copy.map((r) => [r.path, r]))
  for (const c of check) {
    const mine = byPath.get(c.path)
    if (!mine) byPath.set(c.path, c)
    else if ((c.outcome === 'missing' || c.outcome === 'different') && mine.outcome !== 'failed' && mine.outcome !== 'later') byPath.set(c.path, c)
  }
  return [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path))
}

/**
 * Runs downloads and checks, and exposes their progress. Engine callbacks mutate plain
 * objects; React is re-rendered from them a few times a second instead of on every chunk.
 */
export function useTransfers(settings: Settings) {
  const jobs = useRef<Job[]>([])
  const [views, setViews] = useState<TransferView[]>([])
  const dirty = useRef(false)

  const publish = useCallback(() => {
    const now = Date.now()
    setViews(
      jobs.current.map((j) => {
        const s = j.samples
        s.push([now, j.progress.bytesDone])
        while (s.length > 2 && now - s[0][0] > 5000) s.shift()
        const [t0, b0] = s[0]
        const active = j.progress.state === 'running' || j.progress.state === 'verifying'
        const bps = active && now > t0 ? ((j.progress.bytesDone - b0) / (now - t0)) * 1000 : 0
        const counts = count(j.progress.report)
        const finished = ['failed', 'cancelled', 'done'].includes(j.progress.state)
        return {
          ...j.progress,
          current: [...j.progress.current],
          report: [...j.progress.report],
          counts,
          problems: PROBLEMS.reduce((n, o) => n + (counts[o] ?? 0), 0),
          bytesPerSecond: Math.max(0, bps),
          resumable: j.target.kind === 'folder' && finished,
          local: j.target.kind !== 'zip' && finished && !!localTree(j),
        }
      }),
    )
  }, [])

  useEffect(() => {
    const t = setInterval(() => {
      if (dirty.current || jobs.current.some((j) => j.progress.state === 'running' || j.progress.state === 'verifying')) {
        dirty.current = false
        publish()
      }
    }, 250)
    return () => clearInterval(t)
  }, [publish])

  const run = useCallback(
    async (job: Job) => {
      const p = job.progress
      const signal = job.controller.signal
      const touch = () => (dirty.current = true)
      try {
        p.state = 'scanning'
        touch()
        let plan = await planTransfer(job.source, job.roots, {
          exportPref: settings.exportPref,
          signal,
          onProgress: (files, bytes) => {
            p.filesTotal = files
            p.bytesTotal = bytes
            touch()
          },
        })
        if (job.only) plan = subsetPlan(plan, job.only)
        p.filesTotal = plan.files.length
        p.bytesTotal = plan.bytes

        if (job.target.kind === 'verify') {
          const tree = (job.target.tree ??= await lineUp(job.target.dir, plan))
          p.destination = tree.strip ? job.target.dir.name : `${job.target.dir.name}/${plan.folders[0]?.split('/')[0] ?? ''}`
          p.state = 'verifying'
          p.bytesTotal = plan.files.reduce((n, f) => n + (f.item.md5 && !f.exportMime ? (f.size ?? 0) : 0), 0)
          touch()
          p.report = await verifyFolder(plan, tree, {
            deep: true,
            signal,
            onProgress: (files, bytes, current) => {
              p.filesDone = files
              p.bytesDone = bytes
              p.current = current ? [current] : []
            },
          })
          p.state = 'done'
          return
        }

        p.state = 'running'
        p.report = [...plan.skipped]
        touch()
        const events: TransferEvents = {
          fileStart: (path) => p.current.push(path),
          bytes: (n) => (p.bytesDone += n),
          fileDone: (file, actual, outcome, detail) => {
            p.current = p.current.filter((c) => c !== file.path)
            p.filesDone++
            if (outcome === 'reused') {
              p.filesReused++
              p.bytesDone += actual
            }
            // Exports have no size until they are downloaded; failures never arrive.
            if (file.size === undefined) p.bytesTotal += actual
            else if (outcome === 'failed' || outcome === 'later') p.bytesTotal -= file.size
            p.report.push({ path: file.path, outcome, detail, size: actual || file.size })
          },
        }

        if (job.target.kind === 'zip') {
          await writeZip(job.source, plan, job.target.out, events, { signal })
          p.state = 'done'
          return
        }

        const tree = job.target.tree
        p.destination = tree.root.name
        await copyToFolder(job.source, plan, tree, events, { signal, concurrency: settings.concurrency, force: job.force })
        // Cross-check: everything Drive has should now be on disk at the right size.
        p.state = 'verifying'
        p.current = []
        touch()
        p.report = merge(p.report, await verifyFolder(plan, tree, { signal, extras: !job.only }))
        p.state = 'done'
      } catch (e) {
        if (signal.aborted) {
          p.state = 'cancelled'
        } else {
          p.state = 'failed'
          p.error = e instanceof Error ? e.message : String(e)
        }
      } finally {
        p.current = []
        p.finishedAt = Date.now()
        publish()
      }
    },
    [publish, settings.exportPref, settings.concurrency],
  )

  const launch = useCallback(
    (mode: TransferMode, source: DriveSource, roots: DriveItem[], target: Target, label: string, only?: Set<string>, force?: Set<string>) => {
      const job: Job = {
        source,
        roots,
        target,
        only,
        force,
        controller: new AbortController(),
        samples: [],
        progress: {
          id: String(nextId++),
          mode,
          label,
          state: 'scanning',
          filesTotal: 0,
          filesDone: 0,
          filesReused: 0,
          bytesTotal: 0,
          bytesDone: 0,
          current: [],
          report: [],
          startedAt: Date.now(),
        },
      }
      jobs.current = [job, ...jobs.current]
      publish()
      void run(job)
    },
    [publish, run],
  )

  const start = useCallback(
    (mode: TransferMode, source: DriveSource, roots: DriveItem[], target: Target, label: string) => launch(mode, source, roots, target, label),
    [launch],
  )

  const cancel = useCallback((id: string) => {
    jobs.current.find((j) => j.progress.id === id)?.controller.abort()
  }, [])

  const find = (id: string) => jobs.current.find((j) => j.progress.id === id)

  /** Runs a folder copy again; files already on disk at full size are kept. */
  const resume = useCallback(
    (id: string) => {
      const old = find(id)
      if (!old || old.target.kind !== 'folder') return
      jobs.current = jobs.current.filter((j) => j !== old)
      launch('folder', old.source, old.roots, old.target, old.progress.label, old.only, old.force)
    },
    [launch],
  )

  /** Downloads again only the files a copy or check flagged, replacing what's on disk. */
  const fix = useCallback(
    (id: string) => {
      const old = find(id)
      const tree = old && localTree(old)
      if (!old || !tree) return
      const bad = old.progress.report.filter((r) => PROBLEMS.includes(r.outcome))
      if (!bad.length) return
      const only = new Set(bad.map((r) => r.path))
      const force = new Set(bad.filter((r) => r.outcome === 'different').map((r) => r.path))
      launch('folder', old.source, old.roots, { kind: 'folder', tree }, old.progress.label, only, force)
    },
    [launch],
  )

  /** Reads every file back and compares it with Drive's checksums. */
  const recheck = useCallback(
    (id: string) => {
      const old = find(id)
      const tree = old && localTree(old)
      if (!old || !tree) return
      launch('verify', old.source, old.roots, { kind: 'verify', dir: tree.root, tree }, old.progress.label)
    },
    [launch],
  )

  const dismiss = useCallback(
    (id: string) => {
      jobs.current = jobs.current.filter((j) => j.progress.id !== id || ['scanning', 'running', 'verifying'].includes(j.progress.state))
      publish()
    },
    [publish],
  )

  return { transfers: views, start, cancel, resume, fix, recheck, dismiss }
}

function localTree(job: Job): LocalTree | undefined {
  if (job.target.kind === 'folder') return job.target.tree
  if (job.target.kind === 'verify') return job.target.tree
  return undefined
}
