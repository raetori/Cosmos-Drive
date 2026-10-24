import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DemoSource, demoContent } from '../src/lib/demo'
import { virtualRoots } from '../src/lib/google'
import { planTransfer } from '../src/lib/plan'
import { copyToFolder, writeZip, type TransferEvents } from '../src/lib/transfer'
import type { DriveItem, DriveSource } from '../src/lib/types'
import { MemDir } from './memfs'

const myDrive = virtualRoots()[0]

function recorder() {
  const log = { bytes: 0, done: [] as string[], reused: [] as string[], skipped: [] as string[] }
  const events: TransferEvents = {
    fileStart() {},
    bytes: (n) => (log.bytes += n),
    fileDone: (f, _n, reused) => (reused ? log.reused : log.done).push(f.path),
    skip: (p, r) => log.skipped.push(`${p}: ${r}`),
  }
  return { log, events }
}

describe('planTransfer', () => {
  it('walks the whole tree with stable, disk-safe paths', async () => {
    const src = new DemoSource({ bytesPerSecond: 0 })
    const plan = await planTransfer(src, [myDrive], { exportPref: 'office' })
    const paths = plan.files.map((f) => f.path)
    expect(paths).toContain('My Drive/Client Projects/Aurora — Brand Film/Invoice.pdf')
    expect(paths).toContain('My Drive/Client Projects/Aurora — Brand Film/Invoice (2).pdf')
    expect(paths).toContain('My Drive/Client Projects/Aurora — Brand Film/Treatment.docx')
    expect(paths).toContain('My Drive/Client Projects/Aurora — Brand Film/Budget.xlsx')
    expect(plan.folders).toContain('My Drive/Empty folder')
    expect(plan.skipped.map((s) => s.path)).toEqual(
      expect.arrayContaining(['My Drive/Client Projects/Nebula Records — Music Video/Casting sign-up']),
    )
    // The shortcut leads to a folder already in the download: copy it once, at its real location.
    expect(paths.filter((p) => p.endsWith('A001_C003_hero.mov'))).toEqual([
      'My Drive/Client Projects/Aurora — Brand Film/Footage/A001_C003_hero.mov',
    ])
    expect(plan.skipped.map((s) => s.path)).toContain('My Drive/Footage (shortcut)')
    const again = await planTransfer(src, [myDrive], { exportPref: 'office' })
    expect(again.files.map((f) => f.path)).toEqual(paths)
  })

  it('follows a folder shortcut whose target is outside the selection', async () => {
    const src = new DemoSource({ bytesPerSecond: 0 })
    const shortcut = (await src.list(myDrive)).find((i) => i.name === 'Footage (shortcut)')!
    const plan = await planTransfer(src, [shortcut], { exportPref: 'office' })
    expect(plan.files.map((f) => f.path)).toContain('Footage (shortcut)/drone_pass_04.mp4')
  })
})

describe('copyToFolder', () => {
  it('writes every file byte-for-byte and resumes without re-downloading', async () => {
    const src = new DemoSource({ bytesPerSecond: 0 })
    const plan = await planTransfer(src, [myDrive], { exportPref: 'office' })
    const root = new MemDir('root')
    const first = recorder()
    await copyToFolder(src, plan, root as unknown as FileSystemDirectoryHandle, first.events)

    const written = root.flatten()
    expect(written.size).toBe(plan.files.length)
    for (const f of plan.files) {
      const data = written.get(f.path)!
      expect(data, f.path).toBeDefined()
      if (f.size !== undefined) expect(Buffer.compare(data, demoContent(f.item.id, f.size)), f.path).toBe(0)
    }
    expect(root.allDirs()).toContain('My Drive/Empty folder')

    const second = recorder()
    await copyToFolder(src, plan, root as unknown as FileSystemDirectoryHandle, second.events)
    const binaries = plan.files.filter((f) => !f.exportMime).length
    expect(second.log.reused).toHaveLength(binaries)
  })

  it('retries a file whose download drops midway', async () => {
    const base = new DemoSource({ bytesPerSecond: 0 })
    let failures = 0
    const flaky: DriveSource = {
      ...base,
      account: base.account,
      list: (f) => base.list(f),
      get: (id) => base.get(id),
      search: (t) => base.search(t),
      async open(item: DriveItem, exp: string | null) {
        const res = await base.open(item, exp)
        if (failures++ > 0) return res
        const reader = res.body!.getReader()
        let sent = false
        return new Response(
          new ReadableStream({
            async pull(c) {
              if (sent) return c.error(new TypeError('network dropped'))
              c.enqueue((await reader.read()).value!)
              sent = true
            },
          }),
        )
      },
    }
    const photos = (await base.list(myDrive)).find((i) => i.name === 'Photos')!
    const plan = await planTransfer(base, [photos], { exportPref: 'office' })
    const root = new MemDir('root')
    const { log, events } = recorder()
    await copyToFolder(flaky, plan, root as unknown as FileSystemDirectoryHandle, events, { concurrency: 1 })
    expect(log.skipped).toEqual([])
    expect(log.done).toHaveLength(3)
    expect(log.bytes).toBe(plan.bytes)
  })
})

describe('writeZip', () => {
  it('produces one valid zip containing the whole tree', async () => {
    const src = new DemoSource({ bytesPerSecond: 0 })
    const plan = await planTransfer(src, [myDrive], { exportPref: 'pdf' })
    const chunks: Uint8Array[] = []
    const { log, events } = recorder()
    await writeZip(src, plan, new WritableStream({ write: (c) => void chunks.push(c) }), events)
    expect(log.done).toHaveLength(plan.files.length)

    const dir = mkdtempSync(join(tmpdir(), 'cosmos-zip-'))
    const file = join(dir, 'out.zip')
    writeFileSync(file, Buffer.concat(chunks))
    const test = execFileSync('unzip', ['-t', file]).toString()
    expect(test).toContain('No errors detected')
    const listing = execFileSync('unzip', ['-Z1', file]).toString()
    expect(listing).toContain('My Drive/Client Projects/Aurora — Brand Film/Treatment.pdf')
    expect(listing).toContain('My Drive/Empty folder/')
  })
})
