import { useState } from 'react'
import { ACCESS_EMAIL as EMAIL, ACCESS_ENDPOINT as ENDPOINT, AUDIENCE_PAGE } from '../lib/access'
import { Modal } from './Dialogs'

/** While Google keeps CosmoDrive in testing, people ask to join the beta here and we add them as test users. */
export function RequestAccessDialog({ onClose }: { onClose(): void }) {
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [note, setNote] = useState('')
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle')
  const [error, setError] = useState('')

  const send = async () => {
    const who = email.trim()
    const subject = `CosmoDrive access request: ${who}`
    const approve = `Approve: add ${who} under Test users at ${AUDIENCE_PAGE}`
    if (!ENDPOINT) {
      const body = [`Google account: ${who}`, name.trim() && `Name: ${name.trim()}`, note.trim() && `Use: ${note.trim()}`].filter(Boolean)
      location.href = `mailto:${EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent([...body, '', approve].join('\n'))}`
      setState('sent')
      return
    }
    setState('sending')
    setError('')
    try {
      const r = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ _subject: subject, email: who, name: name.trim(), message: note.trim(), approve }),
      })
      if (!r.ok) throw new Error(String(r.status))
      setState('sent')
    } catch {
      setState('idle')
      setError('That didn’t send. Check your connection and try again.')
    }
  }

  if (state === 'sent')
    return (
      <Modal title="Request sent" onClose={onClose}>
        <div className="form">
          <p className="muted">
            We&rsquo;ll add <strong>{email.trim()}</strong> to the beta and let you know. Then click Connect Google Drive and sign in with that
            account.
          </p>
          <footer>
            <button className="btn primary" onClick={onClose}>
              Done
            </button>
          </footer>
        </div>
      </Modal>
    )

  return (
    <Modal title="Request access" onClose={onClose}>
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault()
          void send()
        }}
      >
        <small>
          CosmoDrive is in a private beta while Google reviews it, so Google only lets in the accounts we&rsquo;ve added. Send us yours and
          we&rsquo;ll add it.
        </small>
        <label>
          <span>Your Google account</span>
          <input autoFocus type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@gmail.com" spellCheck={false} />
        </label>
        <label>
          <span>Name (optional)</span>
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label>
          <span>What will you use it for? (optional)</span>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Client footage, archives, backups…" />
        </label>
        {error && <p className="form-error">{error}</p>}
        <footer>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn primary" disabled={state === 'sending' || !email.trim()}>
            {state === 'sending' ? 'Sending…' : 'Send request'}
          </button>
        </footer>
      </form>
    </Modal>
  )
}
