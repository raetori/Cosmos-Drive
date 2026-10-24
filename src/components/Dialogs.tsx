import { useEffect, useRef, useState, type ReactNode } from 'react'
import { parseDriveLink } from '../lib/paths'
import type { Settings } from '../lib/settings'
import type { Account } from '../lib/types'
import { Close } from './Icons'

export function Modal({ title, onClose, children, wide }: { title: string; onClose(): void; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    if (ref.current && !ref.current.open) ref.current.showModal()
  }, [])
  return (
    <dialog ref={ref} className={`modal${wide ? ' wide' : ''}`} onClose={onClose} onCancel={onClose}>
      <header>
        <h2>{title}</h2>
        <button className="icon-btn ghost" onClick={onClose} aria-label="Close">
          <Close />
        </button>
      </header>
      {children}
    </dialog>
  )
}

export function SettingsDialog({ settings, onSave, onClose }: { settings: Settings; onSave(s: Settings): void; onClose(): void }) {
  const [draft, setDraft] = useState(settings)
  const origin = window.location.origin
  return (
    <Modal title="Settings" onClose={onClose}>
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault()
          onSave({ ...draft, clientId: draft.clientId.trim() })
        }}
      >
        <label>
          <span>Google OAuth client ID</span>
          <input
            value={draft.clientId}
            onChange={(e) => setDraft({ ...draft, clientId: e.target.value })}
            placeholder="1234567890-abc123.apps.googleusercontent.com"
            spellCheck={false}
          />
          <small>
            Create one in Google Cloud Console (type “Web application”) and add <code>{origin}</code> as an authorized JavaScript origin.
            Steps are in the README.
          </small>
        </label>
        <label>
          <span>Google Docs, Sheets and Slides download as</span>
          <select value={draft.exportPref} onChange={(e) => setDraft({ ...draft, exportPref: e.target.value as Settings['exportPref'] })}>
            <option value="office">Word, Excel and PowerPoint files</option>
            <option value="pdf">PDF files</option>
          </select>
        </label>
        <label>
          <span>Files downloaded at the same time: {draft.concurrency}</span>
          <input type="range" min={1} max={6} value={draft.concurrency} onChange={(e) => setDraft({ ...draft, concurrency: Number(e.target.value) })} />
          <small>Higher is faster on a good connection. Google may slow down very busy accounts; Cosmos Drive waits and retries when it does.</small>
        </label>
        <footer>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn primary">
            Save
          </button>
        </footer>
      </form>
    </Modal>
  )
}

export function LinkDialog({
  accounts,
  onOpen,
  onClose,
}: {
  accounts: Account[]
  onOpen(account: Account, id: string): Promise<void>
  onClose(): void
}) {
  const [accountId, setAccountId] = useState(accounts.find((a) => !a.demo)?.id ?? accounts[0]?.id)
  const [link, setLink] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  return (
    <Modal title="Open a folder link" onClose={onClose}>
      <form
        className="form"
        onSubmit={async (e) => {
          e.preventDefault()
          const id = parseDriveLink(link)
          const account = accounts.find((a) => a.id === accountId)
          if (!id || !account) {
            setError('That doesn’t look like a Google Drive link.')
            return
          }
          setBusy(true)
          setError('')
          try {
            await onOpen(account, id)
          } catch (err) {
            setError(err instanceof Error ? err.message : String(err))
            setBusy(false)
          }
        }}
      >
        <label>
          <span>Drive folder link</span>
          <input autoFocus value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://drive.google.com/drive/folders/…" spellCheck={false} />
        </label>
        <label>
          <span>Open with account</span>
          <select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.email}
              </option>
            ))}
          </select>
          <small>The account needs access to the folder. It is pinned under that account in the sidebar.</small>
        </label>
        {error && <p className="form-error">{error}</p>}
        <footer>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn primary" disabled={busy || !link.trim()}>
            {busy ? 'Opening…' : 'Open'}
          </button>
        </footer>
      </form>
    </Modal>
  )
}
