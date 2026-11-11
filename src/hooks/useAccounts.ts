import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { DemoSource } from '../lib/demo'
import {
  GoogleDriveSource,
  NeedsConsent,
  ServerSignedOut,
  SignInExpired,
  fetchAccount,
  requestToken,
  revokeToken,
  serverAvailable,
  serverSignIn,
  serverSignOut,
  serverToken,
  silentToken,
  type Token,
} from '../lib/google'
import { load, save } from '../lib/storage'
import type { Account, DriveItem, DriveSource, LinkedFolder } from '../lib/types'

const ACCOUNTS_KEY = 'cosmos.accounts'
const LINKS_KEY = 'cosmos.links'
const TOKENS_KEY = 'cosmos.tokens'
/** Accounts the server keeps signed in (just their ids; the sign-in itself is in an HttpOnly cookie). */
const SERVER_KEY = 'cosmos.staySignedIn'

/** Renew a token this long before Google's one-hour limit, so a long download never hits it. */
const RENEW_AHEAD = 10 * 60_000

/** An account whose Google session ran out and needs a click to sign in again. */
export interface Reauth {
  account: Account
  resolve: (token: string) => void
  reject: (e: Error) => void
}

export function useAccounts(clientId: string) {
  const [accounts, setAccounts] = useState<Account[]>(() => load(ACCOUNTS_KEY, []))
  const [links, setLinks] = useState<LinkedFolder[]>(() => load(LINKS_KEY, []))
  const [reauth, setReauth] = useState<Reauth | null>(null)

  // Access tokens last an hour. Keep them for this tab only, never in localStorage.
  const tokens = useRef(new Map<string, Token>(Object.entries(load<Record<string, Token>>(TOKENS_KEY, {}, sessionStorage))))
  const pendingRenew = useRef(new Map<string, Promise<string>>())
  const sources = useRef(new Map<string, DriveSource>())

  const storeToken = (id: string, t: Token) => {
    tokens.current.set(id, t)
    save(TOKENS_KEY, Object.fromEntries(tokens.current), sessionStorage)
  }

  const serverIds = useRef(new Set<string>(load<string[]>(SERVER_KEY, [])))
  const setServer = (id: string, on: boolean) => {
    if (on) serverIds.current.add(id)
    else serverIds.current.delete(id)
    save(SERVER_KEY, [...serverIds.current])
  }
  const server = useRef(false)
  useEffect(() => {
    // Ask early so a sign-in click can open Google's popup straight away.
    void serverAvailable().then((ok) => (server.current = ok))
  }, [])

  /**
   * Signs in from a click. When the deployment can keep people signed in, the server
   * takes over renewing; otherwise (local dev) it's Google's one-hour browser sign-in.
   */
  const signIn = async (loginHint?: string): Promise<{ token: Token; account?: Account }> => {
    if (!(server.current || (await serverAvailable()))) return { token: await requestToken(clientId, loginHint) }
    let result
    try {
      result = await serverSignIn(clientId, loginHint)
    } catch (e) {
      if (!(e instanceof NeedsConsent)) throw e
      // Google skipped the refresh token because this account allowed the app before.
      // The grant was reset, so one more popup brings one. Browsers may block it this
      // time (no fresh click); then the person clicks again.
      try {
        result = await serverSignIn(clientId, loginHint)
      } catch {
        throw new Error('One more step: click again and allow access, so we can keep you signed in during long downloads.')
      }
    }
    return { token: result.token, account: { id: result.email, email: result.email, name: result.email } }
  }

  const persistAccounts = (next: Account[]) => {
    setAccounts(next)
    save(ACCOUNTS_KEY, next.filter((a) => !a.demo))
  }

  const clientIdRef = useRef(clientId)
  clientIdRef.current = clientId
  /** Silent renewals in flight, so a timer, a click and a request never open two popups. */
  const silentInFlight = useRef(new Map<string, Promise<string>>())
  /** The token expiry a background renewal already failed for; the timer won't retry it. */
  const silentFailedFor = useRef(new Map<string, number>())
  const lastGestureTry = useRef(new Map<string, number>())

  /** The server renews without a popup; only if it has no sign-in for the account do we try Google's popup. */
  const quietToken = async (account: Account): Promise<Token> => {
    if (serverIds.current.has(account.id)) {
      try {
        return await serverToken(account.email)
      } catch (e) {
        if (!(e instanceof ServerSignedOut)) throw e
        setServer(account.id, false)
      }
    }
    return silentToken(clientIdRef.current, account.email)
  }

  const renewSilently = (account: Account): Promise<string> => {
    let p = silentInFlight.current.get(account.id)
    if (!p) {
      const failedFor = tokens.current.get(account.id)?.expiresAt ?? 0
      p = quietToken(account)
        .then((t) => {
          storeToken(account.id, t)
          silentFailedFor.current.delete(account.id)
          return t.accessToken
        })
        .catch((e) => {
          silentFailedFor.current.set(account.id, failedFor)
          throw e
        })
        .finally(() => silentInFlight.current.delete(account.id))
      silentInFlight.current.set(account.id, p)
    }
    return p
  }

  const sourceFor = useCallback(
    (account: Account): DriveSource => {
      let s = sources.current.get(account.id)
      if (s) return s
      if (account.demo) {
        s = new DemoSource({ glitches: true })
      } else {
        const renew = () => {
          let p = pendingRenew.current.get(account.id)
          if (!p) {
            p = (async () => {
              try {
                return await renewSilently(account)
              } catch {
                // Google wants a click, or the browser blocked its popup. Downloads wait here,
                // paused, until the person signs in again from the banner.
                return new Promise<string>((resolve, reject) => setReauth({ account, resolve, reject }))
              }
            })().finally(() => pendingRenew.current.delete(account.id))
            pendingRenew.current.set(account.id, p)
          }
          return p
        }
        s = new GoogleDriveSource(account, {
          get: async () => {
            const t = tokens.current.get(account.id)
            return t && t.expiresAt - Date.now() > 60_000 ? t.accessToken : renew()
          },
          renew,
        })
      }
      sources.current.set(account.id, s)
      return s
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reads refs only
    [],
  )

  // Renew tokens in the background before they run out. This works without a click
  // when the browser lets the site open pop-ups; otherwise the next click does it.
  useEffect(() => {
    const due = () =>
      accounts.filter((a) => {
        const t = tokens.current.get(a.id)
        return !a.demo && t && t.expiresAt - Date.now() < RENEW_AHEAD
      })
    const tick = setInterval(() => {
      for (const a of due()) {
        if (!serverIds.current.has(a.id) && silentFailedFor.current.get(a.id) === tokens.current.get(a.id)?.expiresAt) continue
        renewSilently(a).catch(() => {})
      }
    }, 30_000)
    // A click or key press lets the browser open Google's popup, so use it to renew any
    // token that is close to running out, or to finish a sign-in a download is waiting on.
    const onGesture = (e: Event) => {
      if (e.target instanceof Element && e.target.closest('.banner')) return
      const waiting = reauth?.account
      const list = due()
      if (waiting && !list.some((a) => a.id === waiting.id)) list.push(waiting)
      for (const a of list) {
        // Don't flash a popup on every click if Google keeps saying no.
        if (Date.now() - (lastGestureTry.current.get(a.id) ?? 0) < 20_000) continue
        lastGestureTry.current.set(a.id, Date.now())
        renewSilently(a)
          .then((token) => {
            if (waiting?.id !== a.id) return
            reauth!.resolve(token)
            setReauth(null)
          })
          .catch(() => {})
      }
    }
    window.addEventListener('pointerdown', onGesture, true)
    window.addEventListener('keydown', onGesture, true)
    return () => {
      clearInterval(tick)
      window.removeEventListener('pointerdown', onGesture, true)
      window.removeEventListener('keydown', onGesture, true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- renewSilently reads refs only
  }, [accounts, reauth])

  // Show it in the tab title too, since the person is usually in another tab during a long copy.
  useEffect(() => {
    if (!reauth) return
    const title = document.title
    document.title = `Paused: sign in to continue · ${title}`
    return () => {
      document.title = title
    }
  }, [reauth])

  /** Opens Google's account chooser and adds whichever account the user picks. */
  const connect = useCallback(async (): Promise<Account> => {
    const { token, account: viaServer } = await signIn()
    const account = await fetchAccount(token.accessToken)
    storeToken(account.id, token)
    setServer(account.id, !!viaServer)
    // The demo has done its job once a real Drive is connected; it's still in the sidebar to bring back.
    setAccounts((prev) => {
      const next = [...prev.filter((a) => a.id !== account.id && !a.demo), account]
      save(ACCOUNTS_KEY, next)
      return next
    })
    return account
    // eslint-disable-next-line react-hooks/exhaustive-deps -- signIn reads refs and clientId
  }, [clientId])

  /** Called from the "Reconnect" button, so the popup counts as user-initiated. */
  const finishReauth = useCallback(async () => {
    if (!reauth) return
    try {
      const { token, account: viaServer } = await signIn(reauth.account.email)
      if (viaServer && viaServer.email.toLowerCase() !== reauth.account.email.toLowerCase()) {
        serverSignOut(viaServer.email)
        throw new Error(`Signed in as ${viaServer.email}, not ${reauth.account.email}`)
      }
      storeToken(reauth.account.id, token)
      setServer(reauth.account.id, !!viaServer)
      reauth.resolve(token.accessToken)
      setReauth(null)
    } catch (e) {
      // Leave the banner up so the user can try again or cancel.
      console.warn(e)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- signIn reads refs and clientId
  }, [clientId, reauth])

  const cancelReauth = useCallback(() => {
    reauth?.reject(new SignInExpired())
    setReauth(null)
  }, [reauth])

  const addDemo = useCallback((): Account => {
    const demo = sourceFor({ id: 'demo', email: 'demo@cosmodrive.app', name: 'Demo account', demo: true }).account
    setAccounts((prev) => (prev.some((a) => a.demo) ? prev : [demo, ...prev]))
    return demo
  }, [sourceFor])

  const disconnect = useCallback(
    (account: Account) => {
      const t = tokens.current.get(account.id)
      if (t) revokeToken(t.accessToken)
      if (serverIds.current.has(account.id)) serverSignOut(account.email)
      setServer(account.id, false)
      tokens.current.delete(account.id)
      save(TOKENS_KEY, Object.fromEntries(tokens.current), sessionStorage)
      sources.current.delete(account.id)
      persistAccounts(accounts.filter((a) => a.id !== account.id))
      const nextLinks = links.filter((l) => l.accountId !== account.id)
      setLinks(nextLinks)
      save(LINKS_KEY, nextLinks)
    },
    [accounts, links],
  )

  const addLink = useCallback((accountId: string, item: DriveItem) => {
    setLinks((prev) => {
      const next = [...prev.filter((l) => !(l.accountId === accountId && l.item.id === item.id)), { accountId, item }]
      save(LINKS_KEY, next)
      return next
    })
  }, [])

  const removeLink = useCallback((link: LinkedFolder) => {
    setLinks((prev) => {
      const next = prev.filter((l) => l !== link)
      save(LINKS_KEY, next)
      return next
    })
  }, [])

  return useMemo(
    () => ({ accounts, links, reauth, sourceFor, connect, finishReauth, cancelReauth, addDemo, disconnect, addLink, removeLink }),
    [accounts, links, reauth, sourceFor, connect, finishReauth, cancelReauth, addDemo, disconnect, addLink, removeLink],
  )
}
