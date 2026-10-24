// Writes a planned selection either into a folder on disk or into one streamed zip.

import { makeZip } from 'client-zip'
import type { Plan } from './plan'
import type { DriveSource, PlannedFile } from './types'

export interface TransferEvents {
  fileStart(path: string): void
  /** Bytes written; negative when a failed attempt is rolled back before a retry. */
  bytes(n: number): void
  /** `actualBytes` lets exports (whose size is unknown up front) join the total. */
  fileDone(file: PlannedFile, actualBytes: number, reused: boolean): void
  skip(path: string, reason: string): void
}

function counted(body: ReadableStream<Uint8Array>, onChunk: (n: number) => void): ReadableStream<Uint8Array> {
  return body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        onChunk(chunk.byteLength)
        controller.enqueue(chunk)
      },
    }),
  )
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

function isAbort(e: unknown, signal?: AbortSignal): boolean {
  return !!signal?.aborted || (e instanceof DOMException && e.name === 'AbortError')
}

// ---------------------------------------------------------------------------
// Copy into a folder

export interface FolderOptions {
  concurrency?: number
  /** Attempts per file before it is reported as skipped. */
  attempts?: number
  signal?: AbortSignal
}

/**
 * Recreates the plan's folder tree under `root` and streams every file into place.
 * Files that already exist with the expected size are kept, so running the same
 * copy again picks up where an interrupted one stopped.
 */
export async function copyToFolder(
  source: DriveSource,
  plan: Plan,
  root: FileSystemDirectoryHandle,
  events: TransferEvents,
  opts: FolderOptions = {},
): Promise<void> {
  const { signal } = opts
  const dirs = new Map<string, Promise<FileSystemDirectoryHandle>>([['', Promise.resolve(root)]])
  const dirFor = (path: string): Promise<FileSystemDirectoryHandle> => {
    let d = dirs.get(path)
    if (!d) {
      const cut = path.lastIndexOf('/')
      const parent = cut < 0 ? '' : path.slice(0, cut)
      const name = path.slice(cut + 1)
      d = dirFor(parent).then((p) => p.getDirectoryHandle(name, { create: true }))
      dirs.set(path, d)
    }
    return d
  }

  for (const folder of plan.folders) await dirFor(folder)

  const queue = [...plan.files]
  const attempts = opts.attempts ?? 3

  const copyOne = async (file: PlannedFile) => {
    const cut = file.path.lastIndexOf('/')
    const dir = await dirFor(cut < 0 ? '' : file.path.slice(0, cut))
    const name = file.path.slice(cut + 1)

    if (file.size !== undefined) {
      const existing = await dir.getFileHandle(name).then((h) => h.getFile()).catch(() => null)
      if (existing && existing.size === file.size) {
        events.fileDone(file, file.size, true)
        return
      }
    }

    events.fileStart(file.path)
    for (let attempt = 1; ; attempt++) {
      let written = 0
      try {
        const res = await source.open(file.item, file.exportMime, signal)
        const handle = await dir.getFileHandle(name, { create: true })
        const writable = await handle.createWritable()
        // pipeTo closes the file on success and discards the partial write on failure.
        await counted(res.body!, (n) => {
          written += n
          events.bytes(n)
        }).pipeTo(writable, { signal })
        events.fileDone(file, written, false)
        return
      } catch (e) {
        if (written) events.bytes(-written)
        if (isAbort(e, signal)) throw e
        // Errors before any bytes arrive come from the API, which already retried them.
        if (attempt >= attempts || !written) {
          events.skip(file.path, message(e))
          return
        }
      }
    }
  }

  const workers = Array.from({ length: opts.concurrency ?? 3 }, async () => {
    while (queue.length) {
      signal?.throwIfAborted()
      await copyOne(queue.shift()!)
    }
  })
  await Promise.all(workers)
}

// ---------------------------------------------------------------------------
// One zip

/**
 * Streams the whole plan into a single zip (ZIP64, so no 2 GB or 4 GB cap) and writes
 * it to `out` as it goes. Files are stored without recompression: most large Drive
 * content (video, images, archives) is already compressed.
 */
export async function writeZip(
  source: DriveSource,
  plan: Plan,
  out: WritableStream<Uint8Array>,
  events: TransferEvents,
  opts: { signal?: AbortSignal } = {},
): Promise<void> {
  const { signal } = opts

  async function* entries() {
    for (const folder of plan.folders) yield { name: folder + '/' }
    for (const file of plan.files) {
      signal?.throwIfAborted()
      let res: Response
      try {
        res = await source.open(file.item, file.exportMime, signal)
      } catch (e) {
        if (isAbort(e, signal)) throw e
        events.skip(file.path, message(e))
        continue
      }
      events.fileStart(file.path)
      let written = 0
      const body = counted(res.body!, (n) => {
        written += n
        events.bytes(n)
      })
      // Report completion once the zip writer has drained this file's stream.
      const done = new TransformStream<Uint8Array, Uint8Array>({
        flush: () => events.fileDone(file, written, false),
      })
      yield {
        name: file.path,
        lastModified: file.item.modifiedTime ? new Date(file.item.modifiedTime) : new Date(),
        input: body.pipeThrough(done),
      }
    }
  }

  await makeZip(entries(), { buffersAreUTF8: true }).pipeTo(out, { signal })
}
