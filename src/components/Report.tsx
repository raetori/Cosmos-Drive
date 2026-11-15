import { useMemo, useState } from 'react'
import type { TransferView } from '../hooks/useTransfers'
import { formatBytes } from '../lib/paths'
import { PROBLEMS, type Outcome } from '../lib/types'
import { outcomeLabel, reportCsv } from '../lib/verify'
import { Modal } from './Dialogs'
import { FileText, ShieldCheck, Wrench } from './Icons'

interface Props {
  transfer: TransferView
  onClose(): void
  onFix(): void
  onRecheck(): void
}

type Filter = 'problems' | 'all' | Outcome

const ORDER: Outcome[] = ['missing', 'different', 'failed', 'later', 'verified', 'saved', 'reused', 'skipped', 'extra']

const TONE: Record<Outcome, 'ok' | 'bad' | 'warn' | 'info'> = {
  verified: 'ok',
  saved: 'ok',
  reused: 'ok',
  missing: 'bad',
  different: 'bad',
  failed: 'bad',
  later: 'warn',
  skipped: 'info',
  extra: 'info',
}

const SHOWN = 500

export function ReportDialog({ transfer: t, onClose, onFix, onRecheck }: Props) {
  const [filter, setFilter] = useState<Filter>(t.problems ? 'problems' : 'all')
  const [query, setQuery] = useState('')

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    return t.report.filter((r) => {
      if (filter === 'problems' && !PROBLEMS.includes(r.outcome)) return false
      if (filter !== 'problems' && filter !== 'all' && r.outcome !== filter) return false
      return !q || r.path.toLowerCase().includes(q)
    })
  }, [t.report, filter, query])

  const inDrive = t.report.filter((r) => r.outcome !== 'extra' && r.outcome !== 'skipped').length
  const good = (t.counts.verified ?? 0) + (t.counts.saved ?? 0) + (t.counts.reused ?? 0)

  const saveCsv = () => {
    const url = URL.createObjectURL(new Blob([reportCsv(t.report)], { type: 'text/csv;charset=utf-8' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `${t.label} - CosmoDrive report.csv`
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 30_000)
  }

  return (
    <Modal title="Download report" onClose={onClose} wide>
      <div className="report">
        <div className="report-head">
          <div>
            <strong>{t.label}</strong>
            <span className="muted">
              {t.mode === 'zip' ? 'Zip download' : t.mode === 'verify' ? 'Checked against Drive' : 'Copied to computer'}
              {t.destination ? ` · ${t.destination}` : ''}
              {t.finishedAt ? ` · ${new Date(t.finishedAt).toLocaleString()}` : ''}
            </span>
          </div>
          <div className={`tally ${t.problems ? 'bad' : 'ok'}`}>
            <span className="tally-num">
              {good.toLocaleString()} / {inDrive.toLocaleString()}
            </span>
            <span className="tally-label">{t.mode === 'zip' ? 'files in the zip and intact' : 'files on your computer match Drive'}</span>
          </div>
        </div>

        <div className="chips" role="tablist" aria-label="Filter">
          <button className={`chip${filter === 'problems' ? ' on' : ''} bad`} onClick={() => setFilter('problems')} disabled={!t.problems}>
            Needs attention <b>{t.problems.toLocaleString()}</b>
          </button>
          <button className={`chip${filter === 'all' ? ' on' : ''}`} onClick={() => setFilter('all')}>
            All <b>{t.report.length.toLocaleString()}</b>
          </button>
          {ORDER.filter((o) => t.counts[o]).map((o) => (
            <button key={o} className={`chip ${TONE[o]}${filter === o ? ' on' : ''}`} onClick={() => setFilter(o)}>
              {outcomeLabel(o)} <b>{t.counts[o]!.toLocaleString()}</b>
            </button>
          ))}
        </div>

        <input className="report-search" placeholder="Filter by file name or folder" value={query} onChange={(e) => setQuery(e.target.value)} />

        <div className="report-list">
          {rows.length === 0 && <p className="muted empty-report">Nothing here.</p>}
          {rows.slice(0, SHOWN).map((r) => (
            <div key={r.outcome + r.path} className="report-row">
              <span className={`dot ${TONE[r.outcome]}`} title={outcomeLabel(r.outcome)} />
              <div className="report-text">
                <span className="report-path" title={r.path}>
                  {r.path}
                </span>
                <span className="muted">
                  {outcomeLabel(r.outcome)}
                  {r.detail ? ` · ${r.detail}` : ''}
                </span>
              </div>
              <span className="report-size">{r.size !== undefined ? formatBytes(r.size) : ''}</span>
            </div>
          ))}
          {rows.length > SHOWN && <p className="muted empty-report">…and {(rows.length - SHOWN).toLocaleString()} more. Save the CSV to see everything.</p>}
        </div>

        <footer className="report-foot">
          <button className="btn" onClick={saveCsv}>
            <FileText width={15} height={15} /> Save as CSV
          </button>
          <span className="spacer" />
          {t.local && t.state === 'done' && (
            <button className="btn ghost" onClick={onRecheck} title="Read every file back from disk and compare it with Drive’s checksum">
              <ShieldCheck width={15} height={15} /> Check every byte
            </button>
          )}
          {t.local && t.problems > 0 && (
            <button className="btn primary" onClick={onFix}>
              <Wrench width={15} height={15} /> Download {t.problems.toLocaleString()} again
            </button>
          )}
        </footer>
      </div>
    </Modal>
  )
}
