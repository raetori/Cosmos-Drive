// Writes a planned selection either into a folder on disk or into one streamed zip,
// checking each file against Google Drive's MD5 checksum as it arrives.

import { makeZip } from 'client-zip'
import { createMD5 } from 'hash-wasm'
import { ChecksumError, explain } from './errors'
import { FolderNameError, type LocalTree } from './localfs'
import type { Plan } from './plan'
import type { DriveSource, Outcome, PlannedFile } from './types'

export interface TransferEvents {
  fileStart(path: string): void
  /** Bytes written; negative when a failed attempt is rolled back before a retry. */
  bytes(n: number): void
  /**
   * A file is settled. `actualBytes` lets exports (whose size is unknown up front) join
   * the total; `outcome` is verified, saved, reused, different, failed or later.
   */
  fileDone(file: PlannedFile, actualBytes: number, outcome: Outcome, detail?: string): void
}

/** Thrown when nothing else in the transfer can succeed (disk full, access lost). */
export class FatalTransferError extends Error {}

function isAbort(e: unknown, signal?: AbortSignal): boolean {
  return !!signal?.aborted || (e instanceof DOMException && e.name === 'AbortError')
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * Opens a file and, if the connection drops partway, reconnects and continues from the
 * last byte received instead of starting over. A 40 GB file that drops at 39 GB only
 * re-downloads what's missing. Google Docs exports can't resume and fail instead.
 */
export async function openResumable(source: DriveSource, file: PlannedFile, signal?: AbortSignal, reconnects = 5): Promise<ReadableStream<Uint8Array>> {
  let reader = (await source.open(file.item, file.exportMime, signal)).body!.getReader()
  let offset = 0
  let tries = 0
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      for (;;) {
        try {
          const { done, value } = await reader.read()
          if (done) return controller.close()
          offset += value.byteLength
          tries = 0
          return controller.enqueue(value)
        } catch (e) {
          if (isAbort(e, signal) || file.exportMime || ++tries > reconnects) throw e
          await sleep(1000 * 2 ** (tries - 1))
          const res = await source.open(file.item, null, signal, offset)
          // Without a partial response the server would send the file from the start again.
          if (offset && res.status !== 206) throw e
          reader = res.body!.getReader()
        }
      }
    },
    cancel(reason) {
      return reader.cancel(reason)
    },
  })
}

/**
 * Counts bytes and, when Drive gave us an MD5, hashes them on the way through. A mismatch
 * errors the stream at the very end, so a folder copy never commits a corrupted file.
 */
async function checked(
  file: PlannedFile,
  body: ReadableStream<Uint8Array>,
  onChunk: (n: number) => void,
  onMismatch: 'error' | 'report',
): Promise<{ stream: ReadableStream<Uint8Array>; matched: () => boolean | null }> {
  const expected = file.exportMime ? undefined : file.item.md5
  const hasher = expected ? await createMD5() : null
  hasher?.init()
  let result: boolean | null = null
  const stream = body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        hasher?.update(chunk)
        onChunk(chunk.byteLength)
        controller.enqueue(chunk)
      },
      flush(controller) {
        if (!hasher) return
        result = hasher.digest('hex') === expected
        if (!result && onMismatch === 'error') controller.error(new ChecksumError())
      },
    }),
  )
  return { stream, matched: () => result }
}

// ---------------------------------------------------------------------------
// Copy into a folder

export interface FolderOptions {
  concurrency?: number
  /** Attempts per file before it is reported as failed. */
  attempts?: number
  signal?: AbortSignal
  /** Paths to download even if a same-size file is already there (a check found them different). */
  force?: Set<string>
}

/**
 * Recreates the plan's folder tree in `tree` and streams every file into place.
 * Files that already exist with the expected size are kept, so running the same
 * copy again picks up where an interrupted one stopped.
 */
export async function copyToFolder(
  source: DriveSource,
  plan: Plan,
  tree: LocalTree,
  events: TransferEvents,
  opts: FolderOptions = {},
): Promise<void> {
  const { signal } = opts
  const attempts = opts.attempts ?? 3

  for (const folder of plan.folders) {
    try {
      await tree.mkdir(folder)
    } catch (e) {
      // A folder name the disk refuses only affects the files inside it; they fail one by one.
      if (!(e instanceof FolderNameError)) throw new FatalTransferError(explain(e).message)
    }
  }

  const queue = [...plan.files]

  const copyOne = async (file: PlannedFile) => {
    const cut = file.path.lastIndexOf('/')
    const name = file.path.slice(cut + 1)

    if (file.size !== undefined && !opts.force?.has(file.path)) {
      const existing = await tree.file(file.path)
      if (existing && existing.size === file.size) {
        events.fileDone(file, file.size, 'reused')
        return
      }
    }

    events.fileStart(file.path)
    for (let attempt = 1; ; attempt++) {
      let written = 0
      try {
        const dir = await tree.mkdir(cut < 0 ? '' : file.path.slice(0, cut))
        const body = await openResumable(source, file, signal)
        const handle = await dir.getFileHandle(name, { create: true })
        const writable = await handle.createWritable()
        const { stream, matched } = await checked(file, body, (n) => {
          written += n
          events.bytes(n)
        }, 'error')
        // pipeTo closes the file on success and discards the partial write on failure.
        await stream.pipeTo(writable, { signal })
        events.fileDone(file, written, matched() ? 'verified' : 'saved')
        return
      } catch (e) {
        if (written) events.bytes(-written)
        if (isAbort(e, signal)) throw e
        const why = explain(e)
        if (why.fatal) throw new FatalTransferError(why.message)
        // A drop mid-file or a corrupted file is worth another go. Errors before any bytes
        // arrive come from the API client, which has already retried what it could.
        const retry = attempt < attempts && (written > 0 || e instanceof ChecksumError)
        if (!retry) {
          events.fileDone(file, 0, why.later ? 'later' : 'failed', why.message)
          return
        }
      }
    }
  }

  let fatal: unknown
  const workers = Array.from({ length: opts.concurrency ?? 3 }, async () => {
    while (queue.length && !fatal) {
      signal?.throwIfAborted()
      try {
        await copyOne(queue.shift()!)
      } catch (e) {
        fatal ??= e
      }
    }
  })
  await Promise.all(workers)
  if (fatal) throw fatal
}

// ---------------------------------------------------------------------------
// One zip

/**
 * Streams the whole plan into a single zip (ZIP64, so no 2 GB or 4 GB cap) and writes
 * it to `out` as it goes. Files are stored without recompression: most large Drive
 * content (video, images, archives) is already compressed. A file that fails its
 * checksum can't be taken back out of a streamed zip, so it is reported as different.
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
      let body: ReadableStream<Uint8Array>
      try {
        body = await openResumable(source, file, signal)
      } catch (e) {
        if (isAbort(e, signal)) throw e
        const why = explain(e)
        events.fileDone(file, 0, why.later ? 'later' : 'failed', why.message)
        continue
      }
      events.fileStart(file.path)
      let written = 0
      const { stream, matched } = await checked(file, body, (n) => {
        written += n
        events.bytes(n)
      }, 'report')
      // Report the file once the zip writer has drained its stream.
      const done = new TransformStream<Uint8Array, Uint8Array>({
        flush: () => {
          const ok = matched()
          if (ok === false) events.fileDone(file, written, 'different', 'Didn’t match Google Drive’s checksum: corrupted on the way. Download this file again.')
          else events.fileDone(file, written, ok ? 'verified' : 'saved')
        },
      })
      yield {
        name: file.path,
        lastModified: file.item.modifiedTime ? new Date(file.item.modifiedTime) : new Date(),
        input: stream.pipeThrough(done),
      }
    }
  }

  await makeZip(entries(), { buffersAreUTF8: true }).pipeTo(out, { signal })
}
