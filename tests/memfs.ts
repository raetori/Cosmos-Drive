// A tiny in-memory stand-in for the File System Access API, enough for the copy and check engines.

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
  /** When set, every write fails with this error (e.g. a full disk). */
  failWrites?: () => Error
  /** Names a buggy storage backend maps back onto the parent folder. */
  aliasNames?: RegExp
  constructor(name: string) {
    this.name = name
  }

  async getDirectoryHandle(name: string, opts?: { create?: boolean }): Promise<MemDir> {
    if (this.aliasNames?.test(name)) return this
    let d = this.dirs.get(name)
    if (!d) {
      if (!opts?.create) throw new DOMException('Not found', 'NotFoundError')
      d = new MemDir(name)
      d.failWrites = this.failWrites
      d.aliasNames = this.aliasNames
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
    return fileHandle(f, this.failWrites)
  }

  async isSameEntry(other: unknown) {
    return other === this
  }

  async *entries(): AsyncGenerator<[string, unknown]> {
    for (const [n, d] of this.dirs) yield [n, d]
    for (const [n, f] of this.files) yield [n, fileHandle(f)]
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

  /** The file at a slash path, for tests to damage. */
  at(path: string): MemFile | undefined {
    const parts = path.split('/')
    return this.parentOf(parts)?.files.get(parts[parts.length - 1])
  }

  remove(path: string): void {
    const parts = path.split('/')
    this.parentOf(parts)?.files.delete(parts[parts.length - 1])
  }

  private parentOf(parts: string[]): MemDir | undefined {
    return parts.slice(0, -1).reduce<MemDir | undefined>((d, p) => d?.dirs.get(p), this)
  }
}

function fileHandle(file: MemFile, failWrites?: () => Error) {
  return {
    kind: 'file' as const,
    name: file.name,
    async getFile() {
      return new File([file.data as BlobPart], file.name)
    },
    async createWritable() {
      if (failWrites) throw failWrites()
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
