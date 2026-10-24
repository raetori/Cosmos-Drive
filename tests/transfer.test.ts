import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DemoSource, demoContent } from '../src/lib/demo'
import { VIRTUAL, virtualRoots } from '../src/lib/google'
import { LocalTree, lineUp } from '../src/lib/localfs'
import { planTransfer, subsetPlan } from '../src/lib/plan'
import { FatalTransferError, copyToFolder, writeZip, type TransferEvents } from '../src/lib/transfer'
import type { DriveItem, DriveSource, Outcome } from '../src/lib/types'
import { reportCsv, verifyFolder } from '../src/lib/verify'
import { MemDir } from './memfs'

const [myDrive, sharedDrives] = virtualRoots()

function recorder() {
  const log = { bytes: 0, outcomes: new Map<string, Outcome>(), details: new Map<string, string>() }
  const events: TransferEvents = {
    fileStart() {},
    bytes: (n) => (log.bytes += n),
    fileDone: (f, _n, outcome, detail) => {
      log.outcomes.set(f.path, outcome)
      if (detail) log.details.set(f.path, detail)
    },
  }
  const only = (o: Outcome) => [...log.outcomes].filter(([, v]) => v === o).map(([k]) => k)
  return { log, events, only }
}

const tree = (root: MemDir, strip?: string) => new LocalTree(root as unknown as FileSystemDirectoryHandle, strip)

/** Wraps a source so tests can spy on or sabotage downloads. */
function wrap(base: DriveSource, open: DriveSource['open']): DriveSource {
  return {
    account: base.account,
    list: (f) => base.list(f),
    get: (id) => base.get(id),
    search: (t) => base.search(t),
    open,
  }
}

async function folderNamed(src: DriveSource, parent: DriveItem, name: string) {
  return (await src.list(parent)).find((i) => i.name === name)!
}

describe('planTransfer', () => {
  it('walks the whole tree with stable, disk-safe paths', async () => {
    const src = new DemoSource({ bytesPerSecond: 0 })
    const plan = await planTransfer(src, [myDrive], { exportPref: 'office' })
    const paths = plan.files.map((f) => f.path)
    expect(paths).toContain('My Drive/Client Projects/Aurora - Brand Film/Invoice.pdf')
    expect(paths).toContain('My Drive/Client Projects/Aurora - Brand Film/Invoice (2).pdf')
    expect(paths).toContain('My Drive/Client Projects/Aurora - Brand Film/Treatment.docx')
    expect(paths).toContain('My Drive/Client Projects/Aurora - Brand Film/Budget.xlsx')
    expect(plan.folders).toContain('My Drive/Empty folder')
    expect(plan.skipped.map((s) => s.path)).toContain('My Drive/Client Projects/Nebula Records - Music Video/Casting sign-up')
    // The shortcut leads to a folder already in the download: copy it once, at its real location.
    expect(paths.filter((p) => p.endsWith('A001_C003_hero.mov'))).toEqual([
      'My Drive/Client Projects/Aurora - Brand Film/Footage/A001_C003_hero.mov',
    ])
    expect(plan.skipped.map((s) => s.path)).toContain('My Drive/Footage (shortcut)')
    const again = await planTransfer(src, [myDrive], { exportPref: 'office' })
    expect(again.files.map((f) => f.path)).toEqual(paths)
  })

  it('follows a folder shortcut whose target is outside the selection', async () => {
    const src = new DemoSource({ bytesPerSecond: 0 })
    const shortcut = await folderNamed(src, myDrive, 'Footage (shortcut)')
    const plan = await planTransfer(src, [shortcut], { exportPref: 'office' })
    expect(plan.files.map((f) => f.path)).toContain('Footage (shortcut)/drone_pass_04.mp4')
  })
})

describe('copyToFolder', () => {
  it('writes every file byte-for-byte, checksum-verified, and resumes without re-downloading', async () => {
    const src = new DemoSource({ bytesPerSecond: 0 })
    const plan = await planTransfer(src, [myDrive], { exportPref: 'office' })
    const root = new MemDir('root')
    const first = recorder()
    await copyToFolder(src, plan, tree(root), first.events)

    const written = root.flatten()
    expect(written.size).toBe(plan.files.length)
    for (const f of plan.files) {
      const data = written.get(f.path)!
      expect(data, f.path).toBeDefined()
      if (f.size !== undefined) expect(Buffer.compare(data, demoContent(f.item.id, f.size)), f.path).toBe(0)
      expect(first.log.outcomes.get(f.path), f.path).toBe(f.exportMime ? 'saved' : 'verified')
    }
    expect(root.allDirs()).toContain('My Drive/Empty folder')

    const second = recorder()
    await copyToFolder(src, plan, tree(root), second.events)
    expect(second.only('reused')).toHaveLength(plan.files.filter((f) => !f.exportMime).length)
  })

  it('catches a corrupted download with the checksum and downloads it again', async () => {
    const src = new DemoSource({ bytesPerSecond: 0, glitches: true })
    const footage = await folderNamed(src, await folderNamed(src, await folderNamed(src, myDrive, 'Client Projects'), 'Aurora - Brand Film'), 'Footage')
    const plan = await planTransfer(src, [footage], { exportPref: 'office' })
    const root = new MemDir('root')
    const { log, events, only } = recorder()
    await copyToFolder(src, plan, tree(root), events, { concurrency: 1 })
    expect(only('verified')).toHaveLength(plan.files.length)
    const drone = plan.files.find((f) => f.path.endsWith('drone_pass_04.mp4'))!
    expect(Buffer.compare(root.at(drone.path)!.data, demoContent(drone.item.id, drone.size!))).toBe(0)
    // The corrupted first attempt was rolled back, so progress adds up exactly.
    expect(log.bytes).toBe(plan.bytes)
  })

  it('reports a file that is corrupted every time and never writes it', async () => {
    const base = new DemoSource({ bytesPerSecond: 0 })
    const photos = await folderNamed(base, myDrive, 'Photos')
    const target = (await base.list(photos))[0]
    const src = wrap(base, async (item, exp, signal, from) => {
      const res = await base.open(item, exp, signal, from)
      if (item.id !== target.id) return res
      const bad = new Uint8Array(await res.arrayBuffer())
      bad[0] ^= 1
      return new Response(bad)
    })
    const plan = await planTransfer(base, [photos], { exportPref: 'office' })
    const root = new MemDir('root')
    const { events, only, log } = recorder()
    await copyToFolder(src, plan, tree(root), events)
    expect(only('failed')).toEqual([`Photos/${target.name}`])
    expect(log.details.get(`Photos/${target.name}`)).toMatch(/checksum/)
    expect(root.at(`Photos/${target.name}`)?.data.length ?? 0).toBe(0)
  })

  it('resumes a dropped connection from the byte it reached instead of starting over', async () => {
    const base = new DemoSource({ bytesPerSecond: 0, glitches: true })
    const offsets: number[] = []
    const src = wrap(base, (item, exp, signal, from) => {
      if (item.name === 'Showreel_2026.mp4') offsets.push(from ?? 0)
      return base.open(item, exp, signal, from)
    })
    const plan = await planTransfer(base, [myDrive], { exportPref: 'office' })
    const showreel = plan.files.find((f) => f.item.name === 'Showreel_2026.mp4')!
    const root = new MemDir('root')
    const rec = recorder()
    await copyToFolder(src, subsetPlan(plan, new Set([showreel.path])), tree(root), rec.events)
    expect(rec.only('verified')).toEqual([showreel.path])
    expect(offsets).toHaveLength(2)
    expect(offsets[0]).toBe(0)
    expect(offsets[1]).toBeGreaterThan(0)
    expect(Buffer.compare(root.at(showreel.path)!.data, demoContent(showreel.item.id, showreel.size!))).toBe(0)
  })

  it('marks files Google has locked as "retry later" with a plain explanation', async () => {
    const src = new DemoSource({ bytesPerSecond: 0, glitches: true })
    const plan = await planTransfer(src, [sharedDrives], { exportPref: 'office' })
    const { events, only, log } = recorder()
    await copyToFolder(src, plan, tree(new MemDir('root')), events)
    const locked = only('later')
    expect(locked).toEqual(['Shared drives/Cosmos Studio/Archive 2025/final_master.mov'])
    expect(log.details.get(locked[0])).toMatch(/24 hours/)
  })

  it('refuses to scatter files when the disk maps a folder name onto its parent', async () => {
    const src = new DemoSource({ bytesPerSecond: 0 })
    const plan = await planTransfer(src, [await folderNamed(src, myDrive, 'Client Projects')], { exportPref: 'office' })
    const root = new MemDir('root')
    root.aliasNames = /^Selects$/
    const { events, only, log } = recorder()
    await copyToFolder(src, plan, tree(root), events)
    expect(only('failed').sort()).toEqual(['Client Projects/Nebula Records - Music Video/Selects/take_12.mp4', 'Client Projects/Nebula Records - Music Video/Selects/take_19.mp4'])
    expect(log.details.get(only('failed')[0])).toMatch(/couldn’t create a folder named “Selects”/)
    expect(root.at('Client Projects/Nebula Records - Music Video/take_12.mp4')).toBeUndefined()
    expect(only('verified').length).toBeGreaterThan(5)
  })

  it('stops the whole copy when the disk is full instead of failing every file', async () => {
    const src = new DemoSource({ bytesPerSecond: 0 })
    const plan = await planTransfer(src, [await folderNamed(src, myDrive, 'Photos')], { exportPref: 'office' })
    const root = new MemDir('root')
    root.failWrites = () => new DOMException('Disk full', 'QuotaExceededError')
    const { events } = recorder()
    await expect(copyToFolder(src, plan, tree(root), events)).rejects.toThrow(FatalTransferError)
    await expect(copyToFolder(src, plan, tree(root), events)).rejects.toThrow(/disk is full/)
  })
})

describe('verifyFolder', () => {
  it('finds missing, incomplete, corrupted and extra files, and the fix run repairs them', async () => {
    const src = new DemoSource({ bytesPerSecond: 0 })
    const plan = await planTransfer(src, [myDrive], { exportPref: 'office' })
    const root = new MemDir('root')
    await copyToFolder(src, plan, tree(root), recorder().events)

    const clean = await verifyFolder(plan, tree(root), { deep: true })
    expect(clean.filter((r) => ['missing', 'different', 'extra'].includes(r.outcome))).toEqual([])

    const photo = 'My Drive/Photos/IMG_4410.HEIC'
    const truncated = 'My Drive/Showreel_2026.mp4'
    const flipped = 'My Drive/Client Projects/Aurora - Brand Film/Audio/VO_take3.wav'
    root.remove(photo)
    root.at(truncated)!.data = root.at(truncated)!.data.slice(0, 1000)
    root.at(flipped)!.data[10] ^= 0xff
    await (await root.getDirectoryHandle('My Drive')).getFileHandle('stray.tmp', { create: true })
    // Files the OS drops in folders are never reported as extra.
    await (await root.getDirectoryHandle('My Drive')).getFileHandle('.DS_Store', { create: true })

    const quick = await verifyFolder(plan, tree(root))
    const status = (r: typeof quick) => Object.fromEntries(r.filter((x) => x.outcome !== 'saved' && x.outcome !== 'skipped').map((x) => [x.path, x.outcome]))
    expect(status(quick)).toEqual({ [photo]: 'missing', [truncated]: 'different', 'My Drive/stray.tmp': 'extra' })

    const deep = await verifyFolder(plan, tree(root), { deep: true })
    const deepStatus = Object.fromEntries(deep.filter((x) => !['verified', 'saved', 'skipped'].includes(x.outcome)).map((x) => [x.path, x.outcome]))
    expect(deepStatus).toEqual({ [photo]: 'missing', [truncated]: 'different', [flipped]: 'different', 'My Drive/stray.tmp': 'extra' })

    const bad = new Set([photo, truncated, flipped])
    const fix = recorder()
    await copyToFolder(src, subsetPlan(plan, bad), tree(root), fix.events, { force: bad })
    expect(fix.only('verified').sort()).toEqual([...bad].sort())
    const after = await verifyFolder(plan, tree(root), { deep: true })
    expect(after.filter((r) => r.outcome === 'missing' || r.outcome === 'different')).toEqual([])
  })

  it('lines up a picked folder that is the Drive folder itself', async () => {
    const src = new DemoSource({ bytesPerSecond: 0 })
    const photos = await folderNamed(src, myDrive, 'Photos')
    const plan = await planTransfer(src, [photos], { exportPref: 'office' })
    const parent = new MemDir('Downloads')
    await copyToFolder(src, plan, tree(parent), recorder().events)

    // Picked "Downloads", which contains "Photos".
    const viaParent = await lineUp(parent as unknown as FileSystemDirectoryHandle, plan)
    expect(viaParent.strip).toBeUndefined()
    // Picked "Photos" itself.
    const inner = parent.dirs.get('Photos')!
    const direct = await lineUp(inner as unknown as FileSystemDirectoryHandle, plan)
    expect(direct.strip).toBe('Photos')
    const report = await verifyFolder(plan, direct, { deep: true })
    expect(report.map((r) => r.outcome)).toEqual(['verified', 'verified', 'verified'])
  })

  it('exports a CSV that spreadsheets cannot run as formulas', () => {
    const csv = reportCsv([
      { path: 'a/=HYPERLINK("x").pdf', outcome: 'missing', detail: 'Not on your computer', size: 10 },
      { path: 'b, c.txt', outcome: 'verified', size: 5 },
    ])
    expect(csv.split('\r\n')[1]).toBe('"a/=HYPERLINK(""x"").pdf",Missing,10,Not on your computer')
    expect(csv).toContain('"b, c.txt",Verified (checksum match),5,')
    const evil = reportCsv([{ path: '=cmd|calc', outcome: 'extra' }])
    expect(evil.split('\r\n')[1].startsWith("'=cmd|calc")).toBe(true)
  })
})

describe('writeZip', () => {
  it('produces one valid zip containing the whole tree, every file checksum-verified', async () => {
    const src = new DemoSource({ bytesPerSecond: 0 })
    const plan = await planTransfer(src, [myDrive], { exportPref: 'pdf' })
    const chunks: Uint8Array[] = []
    const rec = recorder()
    await writeZip(src, plan, new WritableStream({ write: (c) => void chunks.push(c) }), rec.events)
    expect(rec.log.outcomes.size).toBe(plan.files.length)
    expect(rec.only('verified')).toHaveLength(plan.files.filter((f) => !f.exportMime).length)

    const dir = mkdtempSync(join(tmpdir(), 'cosmos-zip-'))
    const file = join(dir, 'out.zip')
    writeFileSync(file, Buffer.concat(chunks))
    const test = execFileSync('unzip', ['-t', file]).toString()
    expect(test).toContain('No errors detected')
    const listing = execFileSync('unzip', ['-Z1', file]).toString()
    expect(listing).toContain('My Drive/Client Projects/Aurora - Brand Film/Treatment.pdf')
    expect(listing).toContain('My Drive/Empty folder/')
  })

  it('flags a corrupted file in the zip, and keeps going when one file is locked', async () => {
    const src = new DemoSource({ bytesPerSecond: 0, glitches: true })
    const root = { id: VIRTUAL.sharedDrives, name: 'Shared drives', mimeType: sharedDrives.mimeType, virtual: true }
    const footage = await folderNamed(src, await folderNamed(src, await folderNamed(src, myDrive, 'Client Projects'), 'Aurora - Brand Film'), 'Footage')
    const plan = await planTransfer(src, [footage, root], { exportPref: 'pdf' })
    const rec = recorder()
    await writeZip(src, plan, new WritableStream(), rec.events)
    expect(rec.only('different')).toEqual(['Footage/drone_pass_04.mp4'])
    expect(rec.only('later')).toEqual(['Shared drives/Cosmos Studio/Archive 2025/final_master.mov'])
  })
})
