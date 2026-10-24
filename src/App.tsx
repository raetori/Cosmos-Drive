import { useCallback, useState } from 'react'
import { Browser } from './components/Browser'
import { LinkDialog, SettingsDialog } from './components/Dialogs'
import { Alert, Close, Logo, Plus } from './components/Icons'
import { Sidebar } from './components/Sidebar'
import { Starfield } from './components/Starfield'
import { Transfers } from './components/Transfers'
import { useAccounts } from './hooks/useAccounts'
import { useTransfers } from './hooks/useTransfers'
import { virtualRoots } from './lib/google'
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
      if (dir) xfer.start('folder', source, items, { kind: 'folder', dir }, label)
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
          <Logo />
          <span className="wordmark">
            COSMOS <em>DRIVE</em>
          </span>
        </div>
        {location && (
          <div className="where">
            <span className="where-title">{location.root.virtual ? location.root.name : 'Linked folder'}</span>
            <span className="where-sub">{location.account.email}</span>
          </div>
        )}
        <div className="topbar-right">
          <button className="btn ghost" onClick={connect}>
            <Plus width={16} height={16} /> Connect account
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
            />
          ) : (
            <Welcome onConnect={connect} onDemo={demo} onSettings={() => setDialog('settings')} />
          )}
        </main>
      </div>

      <Transfers transfers={xfer.transfers} onCancel={xfer.cancel} onResume={xfer.resume} onDismiss={xfer.dismiss} />

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
      <p className="eyebrow">Google Drive, without the zip mess</p>
      <h1>
        Your whole Drive.
        <br />
        <span className="glow">One move.</span>
      </h1>
      <p className="lede">
        Browse every Google account you own, then copy any folder to your computer exactly as it is in Drive. No 2&nbsp;GB splits, no
        twenty zips to merge, no missing files.
      </p>
      <div className="welcome-actions">
        <button className="btn primary large" onClick={onConnect}>
          <Plus width={18} height={18} /> Connect Google Drive
        </button>
        <button className="btn large" onClick={onDemo}>
          Explore the demo
        </button>
      </div>
      <ul className="features">
        <li>
          <strong>Copy to computer</strong>
          <span>Recreates the folder tree on your disk. Stop anytime and resume later: finished files are kept.</span>
        </li>
        <li>
          <strong>One zip, any size</strong>
          <span>Everything streams into a single zip as it downloads, well past 4&nbsp;GB.</span>
        </li>
        <li>
          <strong>Every account, every drive</strong>
          <span>My Drive, shared drives, shared with me, and any folder link.</span>
        </li>
      </ul>
      <button className="link-btn small" onClick={onSettings}>
        Setup: Google client ID and download options
      </button>
      <p className="fine">Files go straight from Google to your computer. Cosmos Drive has no server and never sees them.</p>
    </section>
  )
}

