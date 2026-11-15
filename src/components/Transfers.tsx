import { useState } from 'react'
import type { TransferView } from '../hooks/useTransfers'
import { formatBytes, formatDuration } from '../lib/paths'
import { Alert, Check, Chevron, Close, CopyDown, FileText, Play, ShieldCheck, Wrench, Zip } from './Icons'
import { Orbit } from './Orbit'

interface Props {
  transfers: TransferView[]
  onCancel(id: string): void
  onResume(id: string): void
  onFix(id: string): void
  onRecheck(id: string): void
  onReport(id: string): void
  onDismiss(id: string): void
}

function summary(t: TransferView): string {
  if (t.state === 'scanning') return `Listing Drive… ${t.filesTotal.toLocaleString()} files, ${formatBytes(t.bytesTotal)} so far`
  const files = `${t.filesDone.toLocaleString()} of ${t.filesTotal.toLocaleString()} files`
  const bytes = `${formatBytes(t.bytesDone)} of ${formatBytes(t.bytesTotal)}`
  const left = t.bytesPerSecond > 0 ? formatDuration((t.bytesTotal - t.bytesDone) / t.bytesPerSecond) : '—'
  if (t.state === 'running') return `${files} · ${bytes} · ${formatBytes(t.bytesPerSecond)}/s · ${left} left`
  if (t.state === 'verifying') {
    return t.mode === 'verify' ? `Checking ${files} · ${bytes} read · ${left} left` : 'Cross-checking your folder against Drive…'
  }
  const took = t.finishedAt ? ` in ${formatDuration((t.finishedAt - t.startedAt) / 1000)}` : ''
  if (t.state === 'done') {
    if (t.mode === 'verify') return `Checked ${t.filesTotal.toLocaleString()} files${took}`
    const reused = t.filesReused ? ` (${t.filesReused.toLocaleString()} already there)` : ''
    return `${t.filesTotal.toLocaleString()} files${reused} · ${formatBytes(t.bytesDone)}${took}`
  }
  if (t.state === 'cancelled') return `Stopped · ${files}`
  return t.error ?? 'Failed'
}

/** One line that says whether the user can trust what landed on their disk. */
function Verdict({ t }: { t: TransferView }) {
  if (t.state !== 'done' && t.state !== 'cancelled' && t.state !== 'failed') return null
  if (!t.report.length) return null
  const verified = (t.counts.verified ?? 0) + (t.counts.reused ?? 0) + (t.counts.saved ?? 0)
  const fileCount = t.report.filter((r) => r.outcome !== 'skipped' && r.outcome !== 'extra').length
  if (t.problems) {
    return (
      <p className="verdict warn">
        <Alert width={14} height={14} /> {t.problems.toLocaleString()} of {fileCount.toLocaleString()} file{fileCount === 1 ? '' : 's'} need attention
      </p>
    )
  }
  if (t.state !== 'done') return null
  return (
    <p className="verdict ok">
      <ShieldCheck width={14} height={14} />
      {t.mode === 'verify'
        ? `All ${verified.toLocaleString()} files match Google Drive`
        : `All ${verified.toLocaleString()} files are on disk and match Drive`}
      {t.counts.verified ? ` · ${t.counts.verified.toLocaleString()} checksum-verified` : ''}
    </p>
  )
}

function TransferCard({ t, ...on }: { t: TransferView } & Omit<Props, 'transfers'>) {
  const [showCurrent, setShowCurrent] = useState(true)
  const active = t.state === 'scanning' || t.state === 'running' || t.state === 'verifying'
  const pct = t.bytesTotal ? Math.min(100, (t.bytesDone / t.bytesTotal) * 100) : 0
  const ModeIcon = t.mode === 'zip' ? Zip : t.mode === 'verify' ? ShieldCheck : CopyDown
  const title = t.mode === 'zip' ? `${t.label}.zip` : t.mode === 'verify' ? `Check: ${t.label}` : t.label
  const indeterminate = t.state === 'scanning' || (t.state === 'verifying' && t.mode !== 'verify')

  return (
    <article className={`transfer ${t.state}${t.problems && !active ? ' has-problems' : ''}`}>
      <div className="transfer-head">
        <span className="transfer-icon">
          {active ? (
            <Orbit size={20} progress={indeterminate ? undefined : pct / 100} />
          ) : t.state === 'done' && !t.problems ? (
            <Check width={16} height={16} />
          ) : t.state === 'failed' || t.problems ? (
            <Alert width={16} height={16} />
          ) : (
            <ModeIcon width={16} height={16} />
          )}
        </span>
        <div className="transfer-title">
          <strong title={title}>{title}</strong>
          <span className="muted">{summary(t)}</span>
        </div>
        <div className="transfer-buttons">
          {active ? (
            <button className="icon-btn ghost" title="Stop" onClick={() => on.onCancel(t.id)}>
              <Close width={15} height={15} />
            </button>
          ) : (
            <button className="icon-btn ghost" title="Clear from list" onClick={() => on.onDismiss(t.id)}>
              <Close width={15} height={15} />
            </button>
          )}
        </div>
      </div>
      <div className={`bar${indeterminate ? ' indeterminate' : ''}`}>
        <span style={{ width: t.state === 'done' ? '100%' : `${pct}%` }} />
      </div>
      {active && t.current.length > 0 && (
        <>
          <button className="link-btn tiny-link" onClick={() => setShowCurrent((s) => !s)}>
            <Chevron width={11} height={11} className={showCurrent ? 'rot' : ''} /> {t.current.length} in progress
          </button>
          {showCurrent && (
            <ul className="current">
              {t.current.slice(0, 3).map((c) => (
                <li key={c} title={c}>
                  {c}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      <Verdict t={t} />
      {!active && (
        <div className="transfer-actions">
          {t.report.length > 0 && (
            <button className="btn small" onClick={() => on.onReport(t.id)}>
              <FileText width={13} height={13} /> Report
            </button>
          )}
          {t.local && t.problems > 0 && (
            <button className="btn small primary" onClick={() => on.onFix(t.id)} title="Download again only the files that are missing, different or failed">
              <Wrench width={13} height={13} /> Fix {t.problems.toLocaleString()}
            </button>
          )}
          {t.resumable && t.state !== 'done' && (
            <button className="btn small" onClick={() => on.onResume(t.id)} title="Start again; files already copied are kept">
              <Play width={13} height={13} /> Resume
            </button>
          )}
          {t.local && t.state === 'done' && (
            <button className="btn small ghost" onClick={() => on.onRecheck(t.id)} title="Read every file back from disk and compare it with Drive’s checksum">
              <ShieldCheck width={13} height={13} /> Check every byte
            </button>
          )}
        </div>
      )}
    </article>
  )
}

export function Transfers(props: Props) {
  const [open, setOpen] = useState(true)
  if (!props.transfers.length) return null
  const running = props.transfers.filter((t) => ['running', 'scanning', 'verifying'].includes(t.state)).length
  return (
    <section className={`transfers${open ? ' open' : ''}`} aria-label="Transfers">
      <button className="transfers-head" onClick={() => setOpen((o) => !o)}>
        <span>Transfers</span>
        {running > 0 && <span className="pill">{running} active</span>}
        <Chevron width={14} height={14} className={open ? 'rot-down' : 'rot-up'} />
      </button>
      {open && (
        <div className="transfers-list">
          {props.transfers.map((t) => (
            <TransferCard key={t.id} t={t} {...props} />
          ))}
        </div>
      )}
    </section>
  )
}
