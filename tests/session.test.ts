import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { POST as auth } from '../api/auth.js'
import { POST as signout } from '../api/signout.js'
import { POST as token } from '../api/token.js'

const ORIGIN = 'https://drive.example.com'
const SCOPE = 'https://www.googleapis.com/auth/drive.readonly'

function req(path: string, body: unknown, headers: Record<string, string> = {}) {
  return new Request(`${ORIGIN}${path}`, {
    method: 'POST',
    headers: { origin: ORIGIN, host: 'drive.example.com', 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
}

/** Fakes Google's token, about and revoke endpoints. */
function fakeGoogle(opts: { refresh?: string | null; refreshError?: string } = {}) {
  const calls: { url: string; body: string }[] = []
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const body = String(init?.body ?? '')
    calls.push({ url, body })
    if (url.includes('/token')) {
      const p = new URLSearchParams(body)
      if (p.get('grant_type') === 'authorization_code') {
        return Response.json({ access_token: 'at-1', expires_in: 3599, scope: SCOPE, ...(opts.refresh === null ? {} : { refresh_token: opts.refresh ?? 'rt-secret' }) })
      }
      if (opts.refreshError) return Response.json({ error: opts.refreshError }, { status: 400 })
      return Response.json({ access_token: `at-from-${p.get('refresh_token')}`, expires_in: 3599 })
    }
    if (url.includes('/about')) return Response.json({ user: { emailAddress: 'me@example.com' } })
    return new Response('{}')
  })
  return calls
}

const cookieOf = (r: Response) => r.headers.get('set-cookie')!.split(';')[0]

beforeEach(() => {
  vi.stubEnv('GOOGLE_CLIENT_ID', 'client-id')
  vi.stubEnv('GOOGLE_CLIENT_SECRET', 'client-secret')
  vi.stubEnv('SESSION_KEY', 'x'.repeat(48))
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('server sign-in', () => {
  it('keeps the refresh token in an encrypted HttpOnly cookie and renews from it without a popup', async () => {
    fakeGoogle()
    const r = await auth(req('/api/auth', { code: 'one-time' }))
    expect(r.status).toBe(200)
    expect(await r.json()).toMatchObject({ access_token: 'at-1', email: 'me@example.com' })
    const setCookie = r.headers.get('set-cookie')!
    expect(setCookie).toMatch(/HttpOnly; Secure; SameSite=Strict/)
    expect(setCookie).not.toContain('rt-secret')

    const t = await token(req('/api/token', { email: 'me@example.com' }, { cookie: cookieOf(r) }))
    expect(await t.json()).toMatchObject({ access_token: 'at-from-rt-secret' })
  })

  it('refuses other sites, missing cookies and tampered cookies', async () => {
    fakeGoogle()
    const r = await auth(req('/api/auth', { code: 'one-time' }))
    const cookie = cookieOf(r)
    expect((await token(req('/api/token', { email: 'me@example.com' }, { cookie, origin: 'https://evil.example' }))).status).toBe(403)
    expect((await token(req('/api/token', { email: 'me@example.com' }))).status).toBe(401)
    expect((await token(req('/api/token', { email: 'other@example.com' }, { cookie }))).status).toBe(401)
    const tampered = cookie.slice(0, -4) + 'AAAA'
    expect((await token(req('/api/token', { email: 'me@example.com' }, { cookie: tampered }))).status).toBe(401)
  })

  it('resets the grant when Google leaves out the refresh token, so the next sign-in brings one', async () => {
    const calls = fakeGoogle({ refresh: null })
    const r = await auth(req('/api/auth', { code: 'one-time' }))
    expect(r.status).toBe(409)
    expect(r.headers.get('set-cookie')).toBeNull()
    expect(calls.some((c) => c.url.includes('/revoke'))).toBe(true)
  })

  it('clears the cookie when Google says the sign-in is gone, and on sign-out', async () => {
    fakeGoogle()
    const cookie = cookieOf(await auth(req('/api/auth', { code: 'one-time' })))
    fakeGoogle({ refreshError: 'invalid_grant' })
    const t = await token(req('/api/token', { email: 'me@example.com' }, { cookie }))
    expect(t.status).toBe(401)
    expect(t.headers.get('set-cookie')).toMatch(/Max-Age=0/)

    const calls = fakeGoogle()
    const s = await signout(req('/api/signout', { email: 'me@example.com' }, { cookie }))
    expect(s.headers.get('set-cookie')).toMatch(/Max-Age=0/)
    expect(calls.some((c) => c.url.includes('/revoke'))).toBe(true)
  })

  it('reports when the keys are not set', async () => {
    vi.stubEnv('GOOGLE_CLIENT_SECRET', '')
    expect((await auth(req('/api/auth', { code: 'x' }))).status).toBe(503)
  })
})
