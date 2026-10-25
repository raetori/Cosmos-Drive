import { useState, type ReactNode } from 'react'
import { ACCESS_EMAIL as EMAIL, ACCESS_ENDPOINT as ENDPOINT, AUDIENCE_PAGE } from '../lib/access'
import { Modal } from './Dialogs'
import { Check, ShieldCheck } from './Icons'

/**
 * While Google keeps CosmoDrive in testing, people ask to join the beta here and we add them as test users.
 * `onRetry` is set when it opens after a sign-in popup closed: Google never says whether the account was blocked or the
 * window was just closed, so the copy covers both.
 */
export function RequestAccessDialog({ onClose, onRetry }: { onClose(): void; onRetry?(): void }) {
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
    <Modal title={onRetry ? 'Didn’t get in?' : 'Request access'} onClose={onClose}>
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault()
          void send()
        }}
      >
        <small>
          CosmoDrive is in a private beta, so Google only lets in accounts we&rsquo;ve added. Send us your Google account and we&rsquo;ll add
          it.
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
        <SignInSafety />
        <footer>
          {onRetry ? (
            <button type="button" className="btn" onClick={onRetry}>
              Try signing in again
            </button>
          ) : (
            <button type="button" className="btn" onClick={onClose}>
              Cancel
            </button>
          )}
          <button type="submit" className="btn primary" disabled={state === 'sending' || !email.trim()}>
            {state === 'sending' ? 'Sending…' : 'Send request'}
          </button>
        </footer>
      </form>
    </Modal>
  )
}

/** What we can and can't do with a Google account. Keep every line literally true: no "verified" or "by Google" claims. */
export function SignInSafety({ wide, children }: { wide?: boolean; children?: ReactNode }) {
  return (
    <aside className={`trust${wide ? ' wide' : ''}`}>
      <header>
        <ShieldCheck width={16} height={16} />
        <span className="eyebrow">Your account stays yours</span>
      </header>
      <ul>
        <li>
          <Check width={14} height={14} />
          <span>
            <strong>Google&rsquo;s own sign-in page.</strong> We never see or store your password.
          </span>
        </li>
        <li>
          <Check width={14} height={14} />
          <span>
            <strong>Your files stay private.</strong> Nobody at CosmoDrive can see them. We have no server, so they go straight from Google
            to your computer.
          </span>
        </li>
        <li>
          <Check width={14} height={14} />
          <span>
            <strong>Copy only.</strong> The app can copy your files to your computer, but it can&rsquo;t change or delete anything in your
            Drive.
          </span>
        </li>
        <li>
          <Check width={14} height={14} />
          <span>
            <strong>Yours to end.</strong> Remove our access anytime at{' '}
            <a href="https://myaccount.google.com/permissions" target="_blank" rel="noreferrer">
              myaccount.google.com/permissions
            </a>
            .
          </span>
        </li>
      </ul>
      {children}
    </aside>
  )
}
