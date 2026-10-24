import { useCallback, useState } from 'react'
import { Browser } from './components/Browser'
import { LinkDialog, SettingsDialog } from './components/Dialogs'
import { Alert, Close } from './components/Icons'
import { ReportDialog } from './components/Report'
import { Sidebar } from './components/Sidebar'
import { Starfield } from './components/Starfield'
import { Transfers } from './components/Transfers'
import { useAccounts } from './hooks/useAccounts'
import { useTransfers } from './hooks/useTransfers'
import { virtualRoots } from './lib/google'
import { LocalTree } from './lib/localfs'
import { isFolder } from './lib/paths'
import { canSaveFile, pickFolder, zipDestination } from './lib/pickers'
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
  const [dialog, setDialog] = useState<'settings' | 'link' | null>(null)
  const [reportId, setReportId] = useState<string | null>(null)
  const report = xfer.transfers.find((t) => t.id === reportId)
  const [toast, setToast] = useState<{ text: string; tone?: 'warn' } | null>(null)

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
      fail(e)
    }
  }, [acc, settings.clientId])

  const demo = () => setLocation({ account: acc.addDemo(), root: virtualRoots()[0] })

  const copy = async (source: DriveSource, items: DriveItem[], label: string) => {
    try {
      const dir = await pickFolder()
      if (dir) xfer.start('folder', source, items, { kind: 'folder', tree: new LocalTree(dir) }, label)
    } catch (e) {
      fail(e)
    }
  }

  const check = async (source: DriveSource, items: DriveItem[], label: string) => {
    try {
      const dir = await pickFolder()
      if (dir) xfer.start('verify', source, items, { kind: 'verify', dir }, label)
    } catch (e) {
      fail(e)
    }
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

  const openLink = async (account: Account, id: string) => {
    const item = await acc.sourceFor(account).get(id)
    if (!isFolder(item.mimeType)) throw new Error('That link is to a single file. Paste the link of the folder it’s in.')
    acc.addLink(account.id, item)
    setLocation({ account, root: item })
    setDialog(null)
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
          <span className="wordmark">Cosmos Drive</span>
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
            />
          ) : (
            <Welcome onConnect={connect} onDemo={demo} onSettings={() => setDialog('settings')} />
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
      {dialog === 'link' && <LinkDialog accounts={acc.accounts} onOpen={openLink} onClose={() => setDialog(null)} />}
    </div>
  )
}

function Welcome({ onConnect, onDemo, onSettings }: { onConnect(): void; onDemo(): void; onSettings(): void }) {
  return (
    <section className="welcome">
      <p className="eyebrow">Creation of Cosmos</p>
      <h1 className="title-card">Cosmos Drive</h1>
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
      <button className="link-btn small" onClick={onSettings}>
        Setup: Google client ID and download options
      </button>
      <p className="fine">Files go straight from Google to your computer. We have no server and never see them.</p>
    </section>
  )
}
