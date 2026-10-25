import { useCallback, useState } from 'react'
import { Browser } from './components/Browser'
import { LinkDialog, SettingsDialog } from './components/Dialogs'
import { Alert, Close, Logo } from './components/Icons'
import { ReportDialog } from './components/Report'
import { FolderTargetDialog, type FolderPurpose } from './components/FolderTarget'
import { RequestAccessDialog, SignInSafety } from './components/RequestAccess'
import { Sidebar } from './components/Sidebar'
import { Starfield } from './components/Starfield'
import { Transfers } from './components/Transfers'
import { useAccounts } from './hooks/useAccounts'
import { useTransfers } from './hooks/useTransfers'
import { canRequestAccess } from './lib/access'
import { DriveError, SignInClosed, virtualRoots } from './lib/google'
import { LocalTree } from './lib/localfs'
import { isFolder } from './lib/paths'
import { allowWrite, canSaveFile, zipDestination } from './lib/pickers'
import { loadSettings, saveSettings, type Settings } from './lib/settings'
import type { Account, DriveItem, DriveSource } from './lib/types'

interface Location {
  account: Account
  root: DriveItem
}

export default function App() {
  const [settings, setSettings] = useState<Settings>(loadSettings)
  const acc = useAccounts(settings.clientId)
  const xfer = useTransfers(settings)
  const [location, setLocation] = useState<Location | null>(() => (acc.accounts[0] ? { account: acc.accounts[0], root: virtualRoots()[0] } : null))
  const [dialog, setDialog] = useState<'settings' | 'link' | 'access' | 'blocked' | null>(null)
  const [target, setTarget] = useState<{
    purpose: FolderPurpose
    source: DriveSource
    items: DriveItem[]
    label: string
    pending?: FileSystemDirectoryHandle
  } | null>(null)
  const [reportId, setReportId] = useState<string | null>(null)
  const report = xfer.transfers.find((t) => t.id === reportId)
  const [toast, setToast] = useState<{ text: string; tone?: 'warn'; action?: { label: string; run(): void } } | null>(null)

  const fail = (e: unknown) => setToast({ text: e instanceof Error ? e.message : String(e), tone: 'warn' })

  const connect = useCallback(async () => {
    if (!settings.clientId) {
      setToast({ text: 'Add your Google OAuth client ID first. The README walks through getting one.' })
      setDialog('settings')
      return
    }
    try {
      const account = await acc.connect()
      setLocation({ account, root: virtualRoots()[0] })
    } catch (e) {
      if (e instanceof SignInClosed && canRequestAccess) setDialog('blocked')
      else fail(e)
    }
  }, [acc, settings.clientId])

  const demo = () => setLocation({ account: acc.addDemo(), root: virtualRoots()[0] })

  const copy = (source: DriveSource, items: DriveItem[], label: string) => setTarget({ purpose: 'copy', source, items, label })
  const check = (source: DriveSource, items: DriveItem[], label: string) => setTarget({ purpose: 'check', source, items, label })

  const startInto = (t: NonNullable<typeof target>, dir: FileSystemDirectoryHandle) => {
    setTarget(null)
    if (t.purpose === 'copy') xfer.start('folder', t.source, t.items, { kind: 'folder', tree: new LocalTree(dir) }, t.label)
    else xfer.start('verify', t.source, t.items, { kind: 'verify', dir }, t.label)
  }

  /** A folder dropped straight on the browser: copy into it, or ask for the click Chrome needs first. */
  const dropInto = async (source: DriveSource, items: DriveItem[], label: string, dir: FileSystemDirectoryHandle) => {
    const t = { purpose: 'copy' as const, source, items, label }
    try {
      if (await allowWrite(dir)) return startInto(t, dir)
    } catch {
      // No recent click: the dialog's Allow button supplies one.
    }
    setTarget({ ...t, pending: dir })
  }

  const zip = async (source: DriveSource, items: DriveItem[], label: string) => {
    try {
      const out = await zipDestination(`${label}.zip`)
      if (!out) return
      if (!canSaveFile) {
        setToast({ text: 'This browser builds the zip in memory before saving it. For very large downloads, use Chrome or Edge.', tone: 'warn' })
      }
      xfer.start('zip', source, items, { kind: 'zip', out }, label)
    } catch (e) {
      fail(e)
    }
  }

  const openLink = async (account: Account, id: string, resourceKey?: string) => {
    const source = acc.sourceFor(account)
    let item: DriveItem
    try {
      item = await source.get(id, undefined, resourceKey)
    } catch (e) {
      if (e instanceof DriveError && (e.status === 404 || e.status === 403)) {
        throw new Error(
          `${account.email} can’t open this link. If it was shared with a different email, connect that account. Or ask the sender to share it with ${account.email}, or to set it to “Anyone with the link”.`,
        )
      }
      throw e
    }
    setDialog(null)
    // A single file has no folder to pin, so go straight to choosing where to copy it.
    if (!isFolder(item.mimeType)) return copy(source, [item], item.name.replace(/\.[^.]+$/, '') || item.name)
    acc.addLink(account.id, item)
    setLocation({ account, root: item })
  }

  const disconnect = (account: Account) => {
    acc.disconnect(account)
    if (location?.account.id === account.id) {
      const next = acc.accounts.find((a) => a.id !== account.id)
      setLocation(next ? { account: next, root: virtualRoots()[0] } : null)
    }
  }

  return (
    <div className="app">
      <Starfield />
      <header className="topbar">
        <div className="brand">
          <Logo className="logo" />
          <span className="wordmark">CosmoDrive</span>
        </div>
        {location && (
          <div className="where">
            <span className="where-title">{location.root.virtual ? location.root.name : 'Linked folder'}</span>
            <span className="where-sub">{location.account.email}</span>
          </div>
        )}
        <div className="topbar-right">
          <button className="nav-star" onClick={connect}>
            <span>Connect account</span>
          </button>
        </div>
      </header>

      {acc.reauth && (
        <div className="banner" role="alert">
          <Alert width={16} height={16} />
          <span>
            Google needs you to sign in again as <strong>{acc.reauth.account.email}</strong> to keep going.
          </span>
          <button className="btn small primary" onClick={acc.finishReauth}>
            Sign in
          </button>
          <button className="btn small ghost" onClick={acc.cancelReauth}>
            Not now
          </button>
        </div>
      )}

      <div className="body">
        {acc.accounts.length > 0 && (
          <Sidebar
            accounts={acc.accounts}
            links={acc.links}
            activeAccount={location?.account.id}
            activeRoot={location?.root.id}
            onOpen={(account, root) => setLocation({ account, root })}
            onConnect={connect}
            onAddLink={() => setDialog('link')}
            onDemo={demo}
            onDisconnect={disconnect}
            onRemoveLink={(link) => {
              acc.removeLink(link)
              if (location?.root.id === link.item.id) setLocation({ account: location.account, root: virtualRoots()[0] })
            }}
            onSettings={() => setDialog('settings')}
          />
        )}
        <main className="main">
          {location ? (
            <Browser
              key={`${location.account.id}:${location.root.id}`}
              source={acc.sourceFor(location.account)}
              root={location.root}
              onCopy={copy}
              onZip={zip}
              onCheck={check}
              onDropFolder={(source, items, label, dir) => void dropInto(source, items, label, dir)}
              onDropError={(text) => setToast({ text, tone: 'warn' })}
            />
          ) : (
            <Welcome onConnect={connect} onDemo={demo} onSettings={() => setDialog('settings')} onRequest={() => setDialog('access')} />
          )}
        </main>
      </div>

      <Transfers
        transfers={xfer.transfers}
        onCancel={xfer.cancel}
        onResume={xfer.resume}
        onFix={xfer.fix}
        onRecheck={xfer.recheck}
        onReport={setReportId}
        onDismiss={xfer.dismiss}
      />

      {report && (
        <ReportDialog
          transfer={report}
          onClose={() => setReportId(null)}
          onFix={() => {
            xfer.fix(report.id)
            setReportId(null)
          }}
          onRecheck={() => {
            xfer.recheck(report.id)
            setReportId(null)
          }}
        />
      )}

      {toast && (
        <div className={`toast ${toast.tone ?? ''}`} role="status">
          <span>{toast.text}</span>
          {toast.action && (
            <button
              className="btn small primary"
              onClick={() => {
                toast.action!.run()
                setToast(null)
              }}
            >
              {toast.action.label}
            </button>
          )}
          <button className="icon-btn ghost" onClick={() => setToast(null)} aria-label="Dismiss">
            <Close width={14} height={14} />
          </button>
        </div>
      )}

      {dialog === 'settings' && (
        <SettingsDialog
          settings={settings}
          onClose={() => setDialog(null)}
          onSave={(s) => {
            saveSettings(s)
            setSettings(s)
            setDialog(null)
            setToast(null)
          }}
        />
      )}
      {target && (
        <FolderTargetDialog
          purpose={target.purpose}
          label={target.label}
          pending={target.pending}
          onChosen={(dir) => startInto(target, dir)}
          onClose={() => setTarget(null)}
        />
      )}
      {dialog === 'access' && <RequestAccessDialog onClose={() => setDialog(null)} />}
      {dialog === 'blocked' && (
        <RequestAccessDialog
          onClose={() => setDialog(null)}
          onRetry={() => {
            // Straight from the click, so Chrome lets Google's popup open.
            setDialog(null)
            void connect()
          }}
        />
      )}
      {dialog === 'link' && <LinkDialog accounts={acc.accounts} onOpen={openLink} onClose={() => setDialog(null)} />}
    </div>
  )
}

function Welcome({ onConnect, onDemo, onSettings, onRequest }: { onConnect(): void; onDemo(): void; onSettings(): void; onRequest(): void }) {
  return (
    <section className="welcome">
      <p className="eyebrow">Creation of Cosmos</p>
      <h1 className="title-card">CosmoDrive</h1>
      <h2 className="headline">Your whole Drive. One move.</h2>
      <p className="lede">
        Link every Google account you have, and we copy any folder to your computer exactly as it is in Drive. No 2&nbsp;GB splits, no
        twenty zips to merge, and we check every file when it lands.
      </p>
      <div className="welcome-actions">
        <button className="btn primary large" onClick={onConnect}>
          Connect Google Drive <span className="arrow">→</span>
        </button>
        <button className="btn large" onClick={onDemo}>
          Explore the demo
        </button>
      </div>
      <p className="heads-up">
        <strong>Heads up:</strong> Google will say &ldquo;Google hasn&rsquo;t verified this app.&rdquo; Click Continue (or Advanced &rsaquo; Go to
        CosmoDrive). Making that screen go away can cost thousands a year, just to save you one click. So you click, and CosmoDrive
        stays free.
      </p>
      {canRequestAccess && (
        <div className="beta-card">
          <span className="eyebrow">Private beta</span>
          <p>
            <strong>New here? Request access first.</strong> We add your Google account to the beta by hand, then you sign in with it.
          </p>
          <button className="btn" onClick={onRequest}>
            Request access <span className="arrow">→</span>
          </button>
        </div>
      )}
      <ol className="features">
        <li>
          <span className="eyebrow">01 · Copy</span>
          <strong>The folder, as it is</strong>
          <span>We rebuild the folder tree on your disk. Stop anytime and resume later; finished files stay put.</span>
        </li>
        <li>
          <span className="eyebrow">02 · Zip</span>
          <strong>One zip, any size</strong>
          <span>Everything streams into a single zip as it downloads, well past 4&nbsp;GB.</span>
        </li>
        <li>
          <span className="eyebrow">03 · Check</span>
          <strong>Nothing goes missing</strong>
          <span>We match every file against Drive&rsquo;s checksum and tell you exactly what&rsquo;s missing or broken.</span>
        </li>
      </ol>
      <SignInSafety wide />
      <p className="small beta">
        <button className="link-btn" onClick={onSettings}>
          Download options
        </button>
      </p>
      <p className="fine">Files go straight from Google to your computer. We have no server and never see them.</p>
    </section>
  )
}
