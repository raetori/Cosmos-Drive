import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react'
import { canPickFolder } from '../lib/pickers'
import { formatBytes, formatDate, isFolder, kindOf } from '../lib/paths'
import type { DriveItem, DriveSource } from '../lib/types'
import { Back, Chevron, CopyDown, FileIcon, Forward, Refresh, Search, ShieldCheck, Up, Zip } from './Icons'

type SortKey = 'name' | 'size' | 'modifiedTime' | 'kind'

interface Row {
  key: string
  item: DriveItem
  depth: number
  /** Placeholder rows under an expanded folder that is still loading or failed. */
  status?: 'loading' | 'error' | 'empty'
}

interface Listing {
  items?: DriveItem[]
  error?: string
  loading?: boolean
}

interface Props {
  source: DriveSource
  root: DriveItem
  onCopy(source: DriveSource, items: DriveItem[], label: string): void
  onZip(source: DriveSource, items: DriveItem[], label: string): void
  /** Compare a folder already on the computer with these Drive items. */
  onCheck(source: DriveSource, items: DriveItem[], label: string): void
}

function compare(a: DriveItem, b: DriveItem, key: SortKey, dir: number): number {
  const fa = isFolder(a.mimeType)
  const fb = isFolder(b.mimeType)
  if (fa !== fb) return fa ? -1 : 1
  let r = 0
  if (key === 'size') r = (a.size ?? -1) - (b.size ?? -1)
  else if (key === 'modifiedTime') r = (a.modifiedTime ?? '').localeCompare(b.modifiedTime ?? '')
  else if (key === 'kind') r = kindOf(a.mimeType).localeCompare(kindOf(b.mimeType))
  if (r === 0) r = a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
  return r * dir
}

export function Browser({ source, root, onCopy, onZip, onCheck }: Props) {
  const [stack, setStack] = useState<DriveItem[]>([root])
  const [back, setBack] = useState<DriveItem[][]>([])
  const [fwd, setFwd] = useState<DriveItem[][]>([])
  const [cache, setCache] = useState<Map<string, Listing>>(new Map())
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [anchor, setAnchor] = useState<string | null>(null)
  const [sort, setSort] = useState<{ key: SortKey; dir: number }>({ key: 'name', dir: 1 })
  const [query, setQuery] = useState('')
  const [search, setSearch] = useState<Listing | null>(null)
  const tableRef = useRef<HTMLDivElement>(null)
  const loadingRef = useRef(new Set<string>())

  const folder = stack[stack.length - 1]

  const load = useCallback(
    async (item: DriveItem, force = false) => {
      if (loadingRef.current.has(item.id)) return
      if (!force && cache.get(item.id)?.items) return
      loadingRef.current.add(item.id)
      setCache((c) => new Map(c).set(item.id, { ...c.get(item.id), loading: true, error: undefined }))
      try {
        const items = await source.list(item)
        setCache((c) => new Map(c).set(item.id, { items }))
      } catch (e) {
        setCache((c) => new Map(c).set(item.id, { error: e instanceof Error ? e.message : String(e) }))
      } finally {
        loadingRef.current.delete(item.id)
      }
    },
    [cache, source],
  )

  useEffect(() => {
    void load(folder)
    // Only when the folder changes; `load` changes with every cache update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folder])

  const navigate = (next: DriveItem[]) => {
    setBack((b) => [...b, stack])
    setFwd([])
    setStack(next)
    setSelected(new Set())
    setExpanded(new Set())
    setSearch(null)
    setQuery('')
  }
  const open = (item: DriveItem) => isFolder(item.mimeType) && navigate([...stack, item])
  const goBack = () => {
    const prev = back[back.length - 1]
    if (!prev) return
    setFwd((f) => [stack, ...f])
    setBack((b) => b.slice(0, -1))
    setStack(prev)
    setSelected(new Set())
  }
  const goForward = () => {
    const next = fwd[0]
    if (!next) return
    setBack((b) => [...b, stack])
    setFwd((f) => f.slice(1))
    setStack(next)
    setSelected(new Set())
  }
  const goUp = () => stack.length > 1 && navigate(stack.slice(0, -1))

  const refresh = () => {
    if (search) return runSearch()
    const expandedItems = rows.filter((r) => !r.status && expanded.has(r.key)).map((r) => r.item)
    setCache(new Map())
    for (const item of [folder, ...expandedItems]) void load(item, true)
  }

  const runSearch = async () => {
    const text = query.trim()
    if (!text) {
      setSearch(null)
      return
    }
    setSearch({ loading: true })
    setSelected(new Set())
    try {
      setSearch({ items: await source.search(text) })
    } catch (e) {
      setSearch({ error: e instanceof Error ? e.message : String(e) })
    }
  }

  const toggleExpand = (row: Row) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(row.key)) next.delete(row.key)
      else {
        next.add(row.key)
        void load(row.item)
      }
      return next
    })
  }

  const listing = useMemo<Listing>(() => search ?? cache.get(folder.id) ?? { loading: true }, [search, cache, folder.id])

  const rows = useMemo(() => {
    const out: Row[] = []
    const walk = (items: DriveItem[], depth: number, parentKey: string) => {
      for (const item of [...items].sort((a, b) => compare(a, b, sort.key, sort.dir))) {
        const key = `${parentKey}/${item.id}`
        out.push({ key, item, depth })
        if (!search && expanded.has(key)) {
          const child = cache.get(item.id)
          if (child?.items?.length) walk(child.items, depth + 1, key)
          else out.push({ key: key + '/~', item, depth: depth + 1, status: child?.error ? 'error' : child?.items ? 'empty' : 'loading' })
        }
      }
    }
    walk(listing.items ?? [], 0, folder.id)
    return out
  }, [listing, cache, expanded, sort, search, folder.id])

  const realRows = rows.filter((r) => !r.status)
  const selectedItems = realRows.filter((r) => selected.has(r.key)).map((r) => r.item)

  const clickRow = (e: MouseEvent, row: Row) => {
    if (e.shiftKey && anchor) {
      const keys = realRows.map((r) => r.key)
      const [a, b] = [keys.indexOf(anchor), keys.indexOf(row.key)].sort((x, y) => x - y)
      setSelected(new Set(keys.slice(a, b + 1)))
      return
    }
    if (e.metaKey || e.ctrlKey) {
      setSelected((prev) => {
        const next = new Set(prev)
        if (next.has(row.key)) next.delete(row.key)
        else next.add(row.key)
        return next
      })
    } else {
      setSelected(new Set([row.key]))
    }
    setAnchor(row.key)
  }

  const onKeyDown = (e: KeyboardEvent) => {
    const keys = realRows.map((r) => r.key)
    const current = anchor ? keys.indexOf(anchor) : -1
    const moveTo = (i: number) => {
      const k = keys[Math.max(0, Math.min(keys.length - 1, i))]
      if (!k) return
      setSelected(new Set([k]))
      setAnchor(k)
      tableRef.current?.querySelector(`[data-key="${CSS.escape(k)}"]`)?.scrollIntoView({ block: 'nearest' })
    }
    const row = realRows[current]
    if (e.key === 'ArrowDown') moveTo(current + 1)
    else if (e.key === 'ArrowUp' && !e.altKey && !e.metaKey) moveTo(current - 1)
    else if (e.key === 'ArrowRight' && row && isFolder(row.item.mimeType) && !expanded.has(row.key)) toggleExpand(row)
    else if (e.key === 'ArrowLeft' && row && expanded.has(row.key)) toggleExpand(row)
    else if (e.key === 'Enter' && row) open(row.item)
    else if (e.key === 'Backspace' || (e.key === 'ArrowUp' && (e.altKey || e.metaKey))) goUp()
    else if (e.key === 'a' && (e.metaKey || e.ctrlKey)) setSelected(new Set(keys))
    else if (e.key === 'Escape') setSelected(new Set())
    else return
    e.preventDefault()
  }

  const targets = selectedItems.length ? selectedItems : [folder]
  const label = selectedItems.length === 1 ? selectedItems[0].name : selectedItems.length ? `${selectedItems.length} items from ${folder.name}` : folder.name
  const selectedBytes = selectedItems.reduce((n, i) => n + (i.size ?? 0), 0)
  const selectedFolders = selectedItems.filter((i) => isFolder(i.mimeType)).length

  const header = (key: SortKey, text: string, cls: string) => (
    <button
      className={`th ${cls}${sort.key === key ? ' sorted' : ''}`}
      onClick={() => setSort((s) => ({ key, dir: s.key === key ? -s.dir : 1 }))}
      aria-sort={sort.key === key ? (sort.dir > 0 ? 'ascending' : 'descending') : 'none'}
    >
      {text}
      {sort.key === key && <Chevron width={12} height={12} className={`sort-caret ${sort.dir > 0 ? 'asc' : 'desc'}`} />}
    </button>
  )

  return (
    <div className="browser">
      <div className="toolbar">
        <div className="nav-buttons">
          <button className="icon-btn" title="Back" onClick={goBack} disabled={!back.length}>
            <Back />
          </button>
          <button className="icon-btn" title="Forward" onClick={goForward} disabled={!fwd.length}>
            <Forward />
          </button>
          <button className="icon-btn" title="Enclosing folder" onClick={goUp} disabled={stack.length < 2}>
            <Up />
          </button>
        </div>
        <div className="pathbar" role="navigation" aria-label="Folder path">
          {stack.map((item, i) => (
            <span key={item.id + i} className="crumb">
              {i > 0 && <Chevron width={12} height={12} className="crumb-sep" />}
              <button disabled={i === stack.length - 1 && !search} onClick={() => navigate(stack.slice(0, i + 1))}>
                {item.name}
              </button>
            </span>
          ))}
          {search && (
            <span className="crumb">
              <Chevron width={12} height={12} className="crumb-sep" />
              <button disabled>Search “{query}”</button>
            </span>
          )}
        </div>
        <form
          className="searchbox"
          onSubmit={(e) => {
            e.preventDefault()
            void runSearch()
          }}
        >
          <Search width={15} height={15} />
          <input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              if (!e.target.value) setSearch(null)
            }}
            placeholder="Search this account"
            aria-label="Search this account"
          />
        </form>
        <button className="icon-btn" title="Refresh" onClick={refresh}>
          <Refresh />
        </button>
        <div className="actions">
          <button
            className="btn primary"
            onClick={() => onCopy(source, targets, label)}
            disabled={!canPickFolder}
            title={canPickFolder ? 'Copy into a folder on your computer, keeping the folder structure' : 'Needs Chrome, Edge or another Chromium browser on desktop'}
          >
            <CopyDown width={17} height={17} /> Copy to computer
          </button>
          <button className="btn" onClick={() => onZip(source, targets, label)} title="Download everything as one zip file">
            <Zip width={17} height={17} /> One zip
          </button>
          <button
            className="icon-btn"
            onClick={() => onCheck(source, targets, label)}
            disabled={!canPickFolder}
            title="Check a copy: compare a folder already on your computer with Drive, find what’s missing or broken, and fix it"
            aria-label="Check a copy on your computer"
          >
            <ShieldCheck />
          </button>
        </div>
      </div>

      <div className="table" role="grid" aria-multiselectable tabIndex={0} onKeyDown={onKeyDown} ref={tableRef}>
        <div className="thead" role="row">
          {header('name', 'Name', 'c-name')}
          {header('size', 'Size', 'c-size')}
          {header('modifiedTime', 'Modified', 'c-mod')}
          {header('kind', 'Kind', 'c-kind')}
        </div>
        <div className="tbody">
          {listing.loading && !listing.items && Array.from({ length: 7 }, (_, i) => <div key={i} className="row skeleton" style={{ animationDelay: `${i * 70}ms` }} />)}
          {listing.error && (
            <div className="empty-state">
              <p>Couldn’t load this folder.</p>
              <p className="muted">{listing.error}</p>
              <button className="btn" onClick={refresh}>
                Try again
              </button>
            </div>
          )}
          {listing.items && !rows.length && <div className="empty-state muted">{search ? 'Nothing matches that search.' : 'This folder is empty.'}</div>}
          {rows.map((row) =>
            row.status ? (
              <div key={row.key} className="row placeholder" style={{ paddingLeft: 30 + row.depth * 20 }}>
                {row.status === 'loading' ? 'Loading…' : row.status === 'empty' ? 'Empty folder' : 'Couldn’t load this folder'}
              </div>
            ) : (
              <div
                key={row.key}
                data-key={row.key}
                role="row"
                aria-selected={selected.has(row.key)}
                className={`row${selected.has(row.key) ? ' selected' : ''}`}
                onClick={(e) => clickRow(e, row)}
                onDoubleClick={() => open(row.item)}
              >
                <div className="td c-name" style={{ paddingLeft: 8 + row.depth * 20 }}>
                  {isFolder(row.item.mimeType) && !search ? (
                    <button
                      className={`disclosure${expanded.has(row.key) ? ' open' : ''}`}
                      aria-label={expanded.has(row.key) ? 'Collapse' : 'Expand'}
                      onClick={(e) => {
                        e.stopPropagation()
                        toggleExpand(row)
                      }}
                      onDoubleClick={(e) => e.stopPropagation()}
                    >
                      <Chevron width={13} height={13} />
                    </button>
                  ) : (
                    <span className="disclosure-spacer" />
                  )}
                  <FileIcon mimeType={row.item.mimeType} />
                  <span className="name" title={row.item.name}>
                    {row.item.name}
                  </span>
                  {row.item.shortcutOf && <span className="badge">shortcut</span>}
                </div>
                <div className="td c-size">{isFolder(row.item.mimeType) ? '—' : formatBytes(row.item.size)}</div>
                <div className="td c-mod">{formatDate(row.item.modifiedTime)}</div>
                <div className="td c-kind">{kindOf(row.item.mimeType)}</div>
              </div>
            ),
          )}
        </div>
      </div>

      <div className="statusbar">
        <span>
          {listing.items ? `${listing.items.length} item${listing.items.length === 1 ? '' : 's'}` : ' '}
          {selectedItems.length > 0 && (
            <>
              {' · '}
              <strong>{selectedItems.length} selected</strong>
              {selectedBytes > 0 && ` · ${formatBytes(selectedBytes)}`}
              {selectedFolders > 0 && ` + ${selectedFolders} folder${selectedFolders === 1 ? '' : 's'}`}
            </>
          )}
        </span>
        <span className="muted">{selectedItems.length ? 'Copy or zip the selection' : `Nothing selected: Copy or zip takes all of “${folder.name}”`}</span>
      </div>
    </div>
  )
}
