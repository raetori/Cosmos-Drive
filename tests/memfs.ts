// A tiny in-memory stand-in for the File System Access API, enough for the copy engine.

export class MemFile {
  data = new Uint8Array(0)
  name: string
  constructor(name: string) {
    this.name = name
  }
}

export class MemDir {
  kind = 'directory' as const
  dirs = new Map<string, MemDir>()
  files = new Map<string, MemFile>()
  name: string
  constructor(name: string) {
    this.name = name
  }

  async getDirectoryHandle(name: string, opts?: { create?: boolean }) {
    let d = this.dirs.get(name)
    if (!d) {
      if (!opts?.create) throw new DOMException('Not found', 'NotFoundError')
      d = new MemDir(name)
      this.dirs.set(name, d)
    }
    return d
  }

  async getFileHandle(name: string, opts?: { create?: boolean }) {
    let f = this.files.get(name)
    if (!f) {
      if (!opts?.create) throw new DOMException('Not found', 'NotFoundError')
      f = new MemFile(name)
      this.files.set(name, f)
    }
    const file = f
    return {
      async getFile() {
        return new Blob([file.data])
      },
      async createWritable() {
        const parts: Uint8Array[] = []
        // Like the real API, content only lands in the file when the stream closes.
        return new WritableStream<Uint8Array>({
          write(chunk) {
            parts.push(chunk)
          },
          close() {
            const total = parts.reduce((n, p) => n + p.byteLength, 0)
            const out = new Uint8Array(total)
            let o = 0
            for (const p of parts) {
              out.set(p, o)
              o += p.byteLength
            }
            file.data = out
          },
        })
      },
    }
  }

  /** Every file as path -> bytes. */
  flatten(prefix = ''): Map<string, Uint8Array> {
    const out = new Map<string, Uint8Array>()
    for (const [n, f] of this.files) out.set(prefix + n, f.data)
    for (const [n, d] of this.dirs) for (const [p, v] of d.flatten(prefix + n + '/')) out.set(p, v)
    return out
  }

  allDirs(prefix = ''): string[] {
    return [...this.dirs].flatMap(([n, d]) => [prefix + n, ...d.allDirs(prefix + n + '/')])
  }
}
