// Path-based access to a folder the user picked, through the File System Access API.

import type { Plan } from './plan'

/** The browser couldn't create a folder with this name in the picked location. */
export class FolderNameError extends Error {
  constructor(name: string) {
    super(`Your browser couldn’t create a folder named “${name}” here. Rename it in Drive (special characters are the usual cause) and try again.`)
  }
}

/** Files the OS or other apps drop into folders; never reported as extra. */
const JUNK = /^(\.DS_Store|desktop\.ini|Thumbs\.db|\._.*|\.~lock\..*|~\$.*)$/i

/**
 * Maps plan paths (which start with the selection's top folder, e.g. "Footage/A001.mov")
 * onto a picked folder. When `strip` is set, the picked folder *is* that top folder,
 * so "Footage/A001.mov" lives at "<picked>/A001.mov".
 */
export class LocalTree {
  readonly root: FileSystemDirectoryHandle
  readonly strip?: string
  private dirs = new Map<string, Promise<FileSystemDirectoryHandle>>()

  constructor(root: FileSystemDirectoryHandle, strip?: string) {
    this.root = root
    this.strip = strip
  }

  /** The plan path relative to the picked folder. */
  local(path: string): string {
    if (!this.strip) return path
    if (path === this.strip) return ''
    return path.startsWith(this.strip + '/') ? path.slice(this.strip.length + 1) : path
  }

  /** Creates the folder (and its parents) if needed. Takes a plan path. */
  mkdir(path: string): Promise<FileSystemDirectoryHandle> {
    return this.mkdirLocal(this.local(path))
  }

  private mkdirLocal(local: string): Promise<FileSystemDirectoryHandle> {
    if (!local) return Promise.resolve(this.root)
    let d = this.dirs.get(local)
    if (!d) {
      const cut = local.lastIndexOf('/')
      const parent = cut < 0 ? '' : local.slice(0, cut)
      const name = local.slice(cut + 1)
      d = this.mkdirLocal(parent).then(async (p) => {
        const child = await p.getDirectoryHandle(name, { create: true })
        // Some browser storage backends silently map unusual names back onto the parent
        // folder. Writing there would scatter files, so refuse instead.
        if (await child.isSameEntry(p)) throw new FolderNameError(name)
        return child
      })
      // Don't cache a failure (e.g. permission revoked); the next attempt should try again.
      d.catch(() => this.dirs.delete(local))
      this.dirs.set(local, d)
    }
    return d
  }

  /** The existing file at a plan path, or null. Never creates anything. */
  async file(path: string): Promise<File | null> {
    const parts = this.local(path).split('/')
    let dir = this.root
    try {
      for (const part of parts.slice(0, -1)) {
        const child = await dir.getDirectoryHandle(part)
        if (await child.isSameEntry(dir)) return null
        dir = child
      }
      return await (await dir.getFileHandle(parts[parts.length - 1])).getFile()
    } catch {
      return null
    }
  }

  /** Every file under the plan's top-level folders, as plan paths. */
  async *walk(plan: Plan): AsyncGenerator<{ path: string; file: File }> {
    const tops = new Set(plan.folders.filter((f) => !f.includes('/')))
    if (this.strip) {
      yield* walkDir(this.root, this.strip)
      return
    }
    for (const top of tops) {
      const dir = await this.root.getDirectoryHandle(top).catch(() => null)
      if (dir) yield* walkDir(dir, top)
    }
  }
}

type Entries = { entries(): AsyncIterable<[string, FileSystemHandle]> }

async function* walkDir(dir: FileSystemDirectoryHandle, prefix: string): AsyncGenerator<{ path: string; file: File }> {
  for await (const [name, handle] of (dir as unknown as Entries).entries()) {
    if (JUNK.test(name)) continue
    const path = `${prefix}/${name}`
    if (handle.kind === 'directory') yield* walkDir(handle as FileSystemDirectoryHandle, path)
    else yield { path, file: await (handle as FileSystemFileHandle).getFile() }
  }
}

/**
 * Works out how a picked folder lines up with the plan. If the user picked the folder
 * that *contains* the selection's top folder, paths map directly; if they picked the
 * top folder itself (common when checking a copy), its name is stripped.
 */
export async function lineUp(root: FileSystemDirectoryHandle, plan: Plan): Promise<LocalTree> {
  const tops = [...new Set(plan.folders.filter((f) => !f.includes('/')))]
  const looseFiles = plan.files.some((f) => !f.path.includes('/'))
  if (tops.length !== 1 || looseFiles) return new LocalTree(root)
  const [top] = tops
  const hasTop = await root.getDirectoryHandle(top).then(() => true, () => false)
  return hasTop ? new LocalTree(root) : new LocalTree(root, top)
}
