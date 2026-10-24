import { useCallback, useEffect, useRef, useState } from 'react'
import { planTransfer } from '../lib/plan'
import type { Settings } from '../lib/settings'
import { copyToFolder, writeZip, type TransferEvents } from '../lib/transfer'
import type { DriveItem, DriveSource, TransferMode, TransferProgress } from '../lib/types'

export type Target = { kind: 'folder'; dir: FileSystemDirectoryHandle } | { kind: 'zip'; out: WritableStream<Uint8Array> }

interface Job {
  progress: TransferProgress
  source: DriveSource
  roots: DriveItem[]
  target: Target
  controller: AbortController
  /** Recent (time, bytesDone) samples for the speed readout. */
  samples: [number, number][]
}

export interface TransferView extends TransferProgress {
  bytesPerSecond: number
  /** Copies into a folder can be started again and skip what is already there. */
  resumable: boolean
}

let nextId = 1

/**
 * Runs downloads and exposes their progress. Engine callbacks mutate plain objects;
 * React is re-rendered from them a few times a second instead of on every chunk.
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
        const bps = j.progress.state === 'running' && now > t0 ? ((j.progress.bytesDone - b0) / (now - t0)) * 1000 : 0
        return {
          ...j.progress,
          current: [...j.progress.current],
          skipped: [...j.progress.skipped],
          bytesPerSecond: Math.max(0, bps),
          resumable: j.target.kind === 'folder' && ['failed', 'cancelled', 'done'].includes(j.progress.state),
        }
      }),
    )
  }, [])

  useEffect(() => {
    const t = setInterval(() => {
      if (dirty.current || jobs.current.some((j) => j.progress.state === 'running')) {
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
        const plan = await planTransfer(job.source, job.roots, {
          exportPref: settings.exportPref,
          signal,
          onProgress: (files, bytes) => {
            p.filesTotal = files
            p.bytesTotal = bytes
            touch()
          },
        })
        p.filesTotal = plan.files.length
        p.bytesTotal = plan.bytes
        p.skipped = [...plan.skipped]
        p.state = 'running'
        touch()

        const events: TransferEvents = {
          fileStart: (path) => p.current.push(path),
          bytes: (n) => (p.bytesDone += n),
          fileDone: (file, actual, reused) => {
            p.current = p.current.filter((c) => c !== file.path)
            p.filesDone++
            if (reused) {
              p.filesReused++
              p.bytesDone += actual
            }
            // Exports have no size until they are downloaded.
            if (file.size === undefined) p.bytesTotal += actual
          },
          skip: (path, reason) => {
            p.current = p.current.filter((c) => c !== path)
            p.skipped.push({ path, reason })
          },
        }

        if (job.target.kind === 'folder') {
          await copyToFolder(job.source, plan, job.target.dir, events, { signal, concurrency: settings.concurrency })
        } else {
          await writeZip(job.source, plan, job.target.out, events, { signal })
        }
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

  const start = useCallback(
    (mode: TransferMode, source: DriveSource, roots: DriveItem[], target: Target, label: string) => {
      const job: Job = {
        source,
        roots,
        target,
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
          skipped: [],
          startedAt: Date.now(),
        },
      }
      jobs.current = [job, ...jobs.current]
      publish()
      void run(job)
    },
    [publish, run],
  )

  const cancel = useCallback((id: string) => {
    jobs.current.find((j) => j.progress.id === id)?.controller.abort()
  }, [])

  /** Runs a folder copy again; files already on disk at full size are kept. */
  const resume = useCallback(
    (id: string) => {
      const old = jobs.current.find((j) => j.progress.id === id)
      if (!old || old.target.kind !== 'folder') return
      jobs.current = jobs.current.filter((j) => j !== old)
      start('folder', old.source, old.roots, old.target, old.progress.label)
    },
    [start],
  )

  const dismiss = useCallback(
    (id: string) => {
      jobs.current = jobs.current.filter((j) => j.progress.id !== id || ['scanning', 'running'].includes(j.progress.state))
      publish()
    },
    [publish],
  )

  return { transfers: views, start, cancel, resume, dismiss }
}
