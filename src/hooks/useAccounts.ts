import { useCallback, useMemo, useRef, useState } from 'react'
import { DemoSource } from '../lib/demo'
import { GoogleDriveSource, fetchAccount, requestToken, revokeToken, type Token } from '../lib/google'
import { load, save } from '../lib/storage'
import type { Account, DriveItem, DriveSource, LinkedFolder } from '../lib/types'

const ACCOUNTS_KEY = 'cosmos.accounts'
const LINKS_KEY = 'cosmos.links'
const TOKENS_KEY = 'cosmos.tokens'

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

  const persistAccounts = (next: Account[]) => {
    setAccounts(next)
    save(ACCOUNTS_KEY, next.filter((a) => !a.demo))
  }

  const sourceFor = useCallback(
    (account: Account): DriveSource => {
      let s = sources.current.get(account.id)
      if (s) return s
      if (account.demo) {
        s = new DemoSource()
      } else {
        const renew = () => {
          let p = pendingRenew.current.get(account.id)
          if (!p) {
            // Popups need a click, so ask the user rather than opening one from a background download.
            p = new Promise<string>((resolve, reject) => setReauth({ account, resolve, reject })).finally(() =>
              pendingRenew.current.delete(account.id),
            )
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
    [],
  )

  /** Opens Google's account chooser and adds whichever account the user picks. */
  const connect = useCallback(async (): Promise<Account> => {
    const token = await requestToken(clientId)
    const account = await fetchAccount(token.accessToken)
    storeToken(account.id, token)
    setAccounts((prev) => {
      const next = [...prev.filter((a) => a.id !== account.id), account]
      save(ACCOUNTS_KEY, next.filter((a) => !a.demo))
      return next
    })
    return account
  }, [clientId])

  /** Called from the "Reconnect" button, so the popup counts as user-initiated. */
  const finishReauth = useCallback(async () => {
    if (!reauth) return
    try {
      const token = await requestToken(clientId, reauth.account.email)
      storeToken(reauth.account.id, token)
      reauth.resolve(token.accessToken)
      setReauth(null)
    } catch (e) {
      // Leave the banner up so the user can try again or cancel.
      console.warn(e)
    }
  }, [clientId, reauth])

  const cancelReauth = useCallback(() => {
    reauth?.reject(new Error('Google sign-in expired'))
    setReauth(null)
  }, [reauth])

  const addDemo = useCallback((): Account => {
    const demo = sourceFor({ id: 'demo', email: 'demo@cosmos.drive', name: 'Demo account', demo: true }).account
    setAccounts((prev) => (prev.some((a) => a.demo) ? prev : [demo, ...prev]))
    return demo
  }, [sourceFor])

  const disconnect = useCallback(
    (account: Account) => {
      const t = tokens.current.get(account.id)
      if (t) revokeToken(t.accessToken)
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
