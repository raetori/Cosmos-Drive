import { VIRTUAL, virtualRoots } from '../lib/google'
import type { Account, DriveItem, LinkedFolder } from '../lib/types'
import { Close, DriveIcon, FileIcon, LinkIcon, Logout, PeopleIcon, Plus, Settings, SharedDriveIcon } from './Icons'

interface Props {
  accounts: Account[]
  links: LinkedFolder[]
  activeAccount?: string
  activeRoot?: string
  onOpen(account: Account, item: DriveItem): void
  onConnect(): void
  onAddLink(): void
  onDemo(): void
  onDisconnect(account: Account): void
  onRemoveLink(link: LinkedFolder): void
  onSettings(): void
}

const ROOT_ICONS: Record<string, typeof DriveIcon> = {
  [VIRTUAL.myDrive]: DriveIcon,
  [VIRTUAL.sharedDrives]: SharedDriveIcon,
  [VIRTUAL.sharedWithMe]: PeopleIcon,
}

function Avatar({ account }: { account: Account }) {
  if (account.photo) return <img className="avatar" src={account.photo} alt="" referrerPolicy="no-referrer" />
  return <span className="avatar avatar-letter">{(account.name || account.email)[0]?.toUpperCase()}</span>
}

export function Sidebar(p: Props) {
  return (
    <aside className="sidebar">
      <div className="sidebar-scroll">
        {p.accounts.map((account) => {
          const accountLinks = p.links.filter((l) => l.accountId === account.id)
          return (
            <section key={account.id} className="account">
              <header className="account-head">
                <Avatar account={account} />
                <div className="account-text">
                  <span className="account-name">{account.name}</span>
                  <span className="account-email">{account.email}</span>
                </div>
                <button className="icon-btn ghost" title={`Disconnect ${account.email}`} onClick={() => p.onDisconnect(account)}>
                  <Logout width={15} height={15} />
                </button>
              </header>
              <nav>
                {virtualRoots().map((root) => {
                  const Icon = ROOT_ICONS[root.id]
                  const active = p.activeAccount === account.id && p.activeRoot === root.id
                  return (
                    <button key={root.id} className={`nav-item${active ? ' active' : ''}`} onClick={() => p.onOpen(account, root)}>
                      <Icon width={16} height={16} />
                      <span>{root.name}</span>
                    </button>
                  )
                })}
                {accountLinks.map((link) => {
                  const active = p.activeAccount === account.id && p.activeRoot === link.item.id
                  return (
                    <div key={link.item.id} className={`nav-item linked${active ? ' active' : ''}`}>
                      <button className="nav-link" onClick={() => p.onOpen(account, link.item)} title={link.item.name}>
                        <FileIcon mimeType={link.item.mimeType} width={16} height={16} />
                        <span>{link.item.name}</span>
                      </button>
                      <button className="icon-btn ghost tiny" title="Remove from sidebar" onClick={() => p.onRemoveLink(link)}>
                        <Close width={13} height={13} />
                      </button>
                    </div>
                  )
                })}
              </nav>
            </section>
          )
        })}

        <div className="sidebar-actions">
          <button
            className="side-action"
            onClick={p.onConnect}
            title="Google will say “Google hasn’t verified this app.” Click Continue (or Advanced › Go to CosmoDrive)."
          >
            <Plus width={16} height={16} /> Connect Google account
          </button>
          <button className="side-action" onClick={p.onAddLink} disabled={!p.accounts.length}>
            <LinkIcon width={16} height={16} /> Open a folder link
          </button>
          {!p.accounts.some((a) => a.demo) && (
            <button className="side-action subtle" onClick={p.onDemo}>
              <span className="spark" /> Explore the demo drive
            </button>
          )}
        </div>
      </div>
      <footer className="sidebar-foot">
        <button className="side-action subtle" onClick={p.onSettings}>
          <Settings width={16} height={16} /> Settings
        </button>
      </footer>
    </aside>
  )
}
