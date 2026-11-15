// A fake Drive account so the app can be tried (and tested) without a Google client ID.

import { md5 } from 'hash-wasm'
import { DriveError, VIRTUAL } from './google'
import { FOLDER_MIME, SHORTCUT_MIME, type Account, type DriveItem, type DriveSource } from './types'

const KB = 1024
const MB = 1024 * KB
const G = 'application/vnd.google-apps.'

interface Node {
  name: string
  mime?: string
  size?: number
  children?: Node[]
  /** For shortcuts: the id of the target node. */
  target?: string
  id?: string
}

const folder = (name: string, children: Node[], id?: string): Node => ({ name, mime: FOLDER_MIME, children, id })
const file = (name: string, size: number, mime = 'application/octet-stream'): Node => ({ name, size, mime })

const TREE: Record<string, Node[]> = {
  [VIRTUAL.myDrive]: [
    folder('Client Projects', [
      folder('Aurora - Brand Film', [
        folder('Footage', [
          file('A001_C003_hero.mov', 9.4 * MB, 'video/quicktime'),
          file('A001_C007_wide.mov', 7.1 * MB, 'video/quicktime'),
          file('B002_C011_detail.mov', 5.6 * MB, 'video/quicktime'),
          file('drone_pass_04.mp4', 6.2 * MB, 'video/mp4'),
        ], 'demo-footage'),
        folder('Audio', [
          file('VO_take3.wav', 3.3 * MB, 'audio/wav'),
          file('score_v2.wav', 4.8 * MB, 'audio/wav'),
        ]),
        folder('Grade', [file('show_LUT.cube', 420 * KB), file('stills_ref.png', 1.4 * MB, 'image/png')]),
        { name: 'Treatment', mime: G + 'document' },
        { name: 'Budget', mime: G + 'spreadsheet' },
        file('Invoice.pdf', 180 * KB, 'application/pdf'),
        file('Invoice.pdf', 176 * KB, 'application/pdf'),
      ]),
      folder('Nebula Records - Music Video', [
        folder('Selects', [file('take_12.mp4', 8.8 * MB, 'video/mp4'), file('take_19.mp4', 7.9 * MB, 'video/mp4')]),
        { name: 'Pitch deck', mime: G + 'presentation' },
        { name: 'Casting sign-up', mime: G + 'form' },
      ]),
    ]),
    folder('Photos', [
      file('IMG_4410.HEIC', 2.1 * MB, 'image/heic'),
      file('IMG_4411.HEIC', 2.3 * MB, 'image/heic'),
      file('IMG_4412.HEIC', 1.9 * MB, 'image/heic'),
    ]),
    folder('Empty folder', []),
    { name: 'Footage (shortcut)', mime: SHORTCUT_MIME, target: 'demo-footage' },
    file('Showreel_2026.mp4', 12.5 * MB, 'video/mp4'),
    file('notes.txt', 3 * KB, 'text/plain'),
  ],
  [VIRTUAL.sharedDrives]: [
    folder('Cosmos Studio', [
      folder('Archive 2025', [file('final_master.mov', 11.2 * MB, 'video/quicktime'), file('captions.srt', 12 * KB, 'text/plain')]),
      file('Studio handbook.pdf', 640 * KB, 'application/pdf'),
    ]),
  ],
  [VIRTUAL.sharedWithMe]: [
    folder('Selects from Director', [file('dir_cut_v3.mp4', 9.1 * MB, 'video/mp4'), { name: 'Notes', mime: G + 'document' }]),
  ],
}

const EXPORT_SIZE = 96 * KB

export interface DemoOptions {
  /** Simulated download speed in bytes per second; 0 for as fast as possible. */
  bytesPerSecond?: number
  /**
   * Act out the problems people hit with real Drive downloads: one video arrives
   * corrupted the first time, one connection drops midway, and one shared file is
   * locked by Google's download quota.
   */
  glitches?: boolean
}

const GLITCHES: Record<string, 'corrupt-once' | 'drop-once' | 'quota'> = {
  'drone_pass_04.mp4': 'corrupt-once',
  'Showreel_2026.mp4': 'drop-once',
  'final_master.mov': 'quota',
}

export class DemoSource implements DriveSource {
  account: Account = { id: 'demo', email: 'demo@cosmodrive.app', name: 'Demo account', demo: true }
  private nodes = new Map<string, { node: Node; item: DriveItem }>()
  private children = new Map<string, string[]>()
  private bytesPerSecond: number
  private glitches: boolean
  private glitched = new Set<string>()
  private md5s = new Map<string, Promise<string>>()

  constructor(opts: DemoOptions = {}) {
    this.bytesPerSecond = opts.bytesPerSecond ?? 40 * MB
    this.glitches = opts.glitches ?? false
    let n = 0
    const day = Date.UTC(2026, 9, 1)
    const index = (parent: string, nodes: Node[]) => {
      const ids: string[] = []
      for (const node of nodes) {
        const id = node.id ?? `demo-${++n}`
        const item: DriveItem = {
          id,
          name: node.name,
          mimeType: node.mime ?? 'application/octet-stream',
          size: node.size !== undefined ? Math.round(node.size) : undefined,
          modifiedTime: new Date(day + n * 36e5 * 7).toISOString(),
          shortcutTarget: node.target,
        }
        this.nodes.set(id, { node, item })
        ids.push(id)
        if (node.children) index(id, node.children)
      }
      this.children.set(parent, ids)
    }
    for (const [root, nodes] of Object.entries(TREE)) index(root, nodes)
  }

  async list(folder: DriveItem): Promise<DriveItem[]> {
    await delay(120)
    const ids = this.children.get(folder.id)
    if (!ids) throw new Error(`Folder not found: ${folder.name}`)
    return Promise.all(
      ids.map(async (id) => {
        const { item } = this.nodes.get(id)!
        if (item.mimeType === SHORTCUT_MIME && item.shortcutTarget) {
          const target = this.nodes.get(item.shortcutTarget)
          if (target) return { ...(await this.withMd5(target.item)), name: item.name, shortcutOf: id }
        }
        return this.withMd5(item)
      }),
    )
  }

  async get(id: string): Promise<DriveItem> {
    const found = this.nodes.get(id)
    if (!found) throw new Error('File not found')
    return this.withMd5(found.item)
  }

  /** Like Drive, binary files carry an MD5 of their content. */
  private async withMd5(item: DriveItem): Promise<DriveItem> {
    if (item.size === undefined) return item
    let h = this.md5s.get(item.id)
    if (!h) {
      h = md5(demoContent(item.id, item.size))
      this.md5s.set(item.id, h)
    }
    return { ...item, md5: await h }
  }

  async search(text: string): Promise<DriveItem[]> {
    await delay(150)
    const t = text.toLowerCase()
    return [...this.nodes.values()].map((v) => v.item).filter((i) => i.name.toLowerCase().includes(t))
  }

  async open(item: DriveItem, exportMime: string | null, signal?: AbortSignal, from = 0): Promise<Response> {
    await delay(60)
    const size = exportMime ? EXPORT_SIZE : (item.size ?? 0)
    const glitch = this.glitches ? GLITCHES[item.name] : undefined
    if (glitch === 'quota') {
      throw new DriveError(403, 'The download quota for this file has been exceeded.', 'downloadQuotaExceeded')
    }
    let body = bytes(item.id, size, this.bytesPerSecond, signal, from)
    if (glitch && !this.glitched.has(item.id)) {
      this.glitched.add(item.id)
      body = glitch === 'corrupt-once' ? flipByte(body, size >> 1) : dropAfter(body, size >> 1)
    }
    return new Response(body, { status: from ? 206 : 200 })
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

/** Deterministic pseudo-random content, so tests can check what was written. */
export function demoContent(id: string, size: number): Uint8Array {
  const out = new Uint8Array(size)
  let x = 2166136261
  for (const c of id) x = Math.imul(x ^ c.charCodeAt(0), 16777619)
  for (let i = 0; i < size; i++) {
    x ^= x << 13
    x ^= x >>> 17
    x ^= x << 5
    out[i] = x & 0xff
  }
  return out
}

function bytes(id: string, size: number, bytesPerSecond: number, signal?: AbortSignal, from = 0): ReadableStream<Uint8Array> {
  const data = demoContent(id, size)
  const chunk = 256 * KB
  let offset = from
  return new ReadableStream({
    async pull(controller) {
      if (signal?.aborted) {
        controller.error(signal.reason)
        return
      }
      if (offset >= size) {
        controller.close()
        return
      }
      const end = Math.min(size, offset + chunk)
      if (bytesPerSecond) await delay(((end - offset) / bytesPerSecond) * 1000)
      controller.enqueue(data.slice(offset, end))
      offset = end
    },
  })
}

/** Flips one byte in the stream, like a bad network hop or a faulty disk cache. */
function flipByte(body: ReadableStream<Uint8Array>, at: number): ReadableStream<Uint8Array> {
  let seen = 0
  return body.pipeThrough(
    new TransformStream({
      transform(chunk, controller) {
        if (at >= seen && at < seen + chunk.byteLength) {
          chunk = chunk.slice()
          chunk[at - seen] ^= 0xff
        }
        seen += chunk.byteLength
        controller.enqueue(chunk)
      },
    }),
  )
}

/** Ends the stream with a network error partway through. */
function dropAfter(body: ReadableStream<Uint8Array>, after: number): ReadableStream<Uint8Array> {
  let seen = 0
  return body.pipeThrough(
    new TransformStream({
      transform(chunk, controller) {
        if (seen >= after) {
          controller.error(new TypeError('network error'))
          return
        }
        seen += chunk.byteLength
        controller.enqueue(chunk)
      },
    }),
  )
}
