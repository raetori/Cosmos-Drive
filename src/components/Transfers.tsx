import { useState } from 'react'
import type { TransferView } from '../hooks/useTransfers'
import { formatBytes, formatDuration } from '../lib/paths'
import { Alert, Check, Chevron, Close, CopyDown, Play, Zip } from './Icons'

interface Props {
  transfers: TransferView[]
  onCancel(id: string): void
  onResume(id: string): void
  onDismiss(id: string): void
}

function summary(t: TransferView): string {
  if (t.state === 'scanning') return `Scanning folders… ${t.filesTotal.toLocaleString()} files, ${formatBytes(t.bytesTotal)} so far`
  const files = `${t.filesDone.toLocaleString()} of ${t.filesTotal.toLocaleString()} files`
  const bytes = `${formatBytes(t.bytesDone)} of ${formatBytes(t.bytesTotal)}`
  if (t.state === 'running') {
    const left = t.bytesPerSecond > 0 ? formatDuration((t.bytesTotal - t.bytesDone) / t.bytesPerSecond) : '—'
    return `${files} · ${bytes} · ${formatBytes(t.bytesPerSecond)}/s · ${left} left`
  }
  const took = t.finishedAt ? ` in ${formatDuration((t.finishedAt - t.startedAt) / 1000)}` : ''
  if (t.state === 'done') {
    const reused = t.filesReused ? ` (${t.filesReused.toLocaleString()} already on disk)` : ''
    return `${files}${reused} · ${formatBytes(t.bytesDone)}${took}`
  }
  if (t.state === 'cancelled') return `Stopped · ${files}`
  return t.error ?? 'Failed'
}

function TransferCard({ t, onCancel, onResume, onDismiss }: { t: TransferView } & Omit<Props, 'transfers'>) {
  const [showSkipped, setShowSkipped] = useState(false)
  const active = t.state === 'scanning' || t.state === 'running'
  const pct = t.bytesTotal ? Math.min(100, (t.bytesDone / t.bytesTotal) * 100) : 0
  const ModeIcon = t.mode === 'zip' ? Zip : CopyDown

  return (
    <article className={`transfer ${t.state}`}>
      <div className="transfer-head">
        <span className="transfer-icon">
          {t.state === 'done' ? <Check width={16} height={16} /> : t.state === 'failed' ? <Alert width={16} height={16} /> : <ModeIcon width={16} height={16} />}
        </span>
        <div className="transfer-title">
          <strong title={t.label}>
            {t.mode === 'zip' ? `${t.label}.zip` : t.label}
          </strong>
          <span className="muted">{summary(t)}</span>
        </div>
        <div className="transfer-buttons">
          {t.resumable && t.state !== 'done' && (
            <button className="btn small" onClick={() => onResume(t.id)} title="Start again; files already copied are kept">
              <Play width={13} height={13} /> Resume
            </button>
          )}
          {active ? (
            <button className="icon-btn ghost" title="Stop" onClick={() => onCancel(t.id)}>
              <Close width={15} height={15} />
            </button>
          ) : (
            <button className="icon-btn ghost" title="Clear from list" onClick={() => onDismiss(t.id)}>
              <Close width={15} height={15} />
            </button>
          )}
        </div>
      </div>
      <div className={`bar${t.state === 'scanning' ? ' indeterminate' : ''}`}>
        <span style={{ width: t.state === 'done' ? '100%' : `${pct}%` }} />
      </div>
      {active && t.current.length > 0 && (
        <ul className="current">
          {t.current.slice(0, 3).map((c) => (
            <li key={c} title={c}>
              {c}
            </li>
          ))}
        </ul>
      )}
      {t.skipped.length > 0 && (
        <div className="skipped">
          <button className="link-btn" onClick={() => setShowSkipped((s) => !s)}>
            <Chevron width={12} height={12} className={showSkipped ? 'rot' : ''} />
            {t.skipped.length} skipped
          </button>
          {showSkipped && (
            <ul>
              {t.skipped.map((s) => (
                <li key={s.path}>
                  <span className="skip-path">{s.path}</span>
                  <span className="muted">{s.reason}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </article>
  )
}

export function Transfers(props: Props) {
  const [open, setOpen] = useState(true)
  if (!props.transfers.length) return null
  const running = props.transfers.filter((t) => t.state === 'running' || t.state === 'scanning').length
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
            <TransferCard key={t.id} t={t} onCancel={props.onCancel} onResume={props.onResume} onDismiss={props.onDismiss} />
          ))}
        </div>
      )}
    </section>
  )
}
