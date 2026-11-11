// Server half of "stay signed in". Google's browser sign-in only hands out one-hour
// tokens, and renewing them needs a popup. Here the server swaps a one-time sign-in code
// for a refresh token, keeps it encrypted in an HttpOnly cookie that page scripts can't
// read, and mints fresh access tokens from it whenever the app asks. No popups, so long
// downloads keep going while nobody is at the computer.
//
// Environment (Vercel → Project → Settings → Environment Variables):
//   GOOGLE_CLIENT_ID      the same public client ID the app is built with
//   GOOGLE_CLIENT_SECRET  that client's secret (Google Cloud → Credentials)
//   SESSION_KEY           a long random string used to encrypt the cookie

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'

export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.readonly'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const COOKIE_PREFIX = 'cd_rt_'
const MAX_AGE = 60 * 60 * 24 * 180

export interface Config {
  clientId: string
  clientSecret: string
  key: Buffer
}

export function config(): Config | null {
  const clientId = process.env.GOOGLE_CLIENT_ID || process.env.VITE_GOOGLE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET
  const secret = process.env.SESSION_KEY
  if (!clientId || !clientSecret || !secret || secret.length < 32) return null
  return { clientId, clientSecret, key: createHash('sha256').update(secret).digest() }
}

export function json(body: unknown, status = 200, headers: Record<string, string | string[]> = {}): Response {
  const h = new Headers({ 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
  for (const [k, v] of Object.entries(headers)) for (const one of [v].flat()) h.append(k, one)
  return new Response(JSON.stringify(body), { status, headers: h })
}

/**
 * Only the app itself may use these endpoints: a POST from this exact origin, with JSON.
 * Together with SameSite=Strict cookies that stops other sites from minting tokens.
 */
export function checkRequest(req: Request): Response | null {
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)
  const origin = req.headers.get('origin')
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host')
  if (!origin || !host || origin !== `https://${host}`) return json({ error: 'forbidden' }, 403)
  if (!req.headers.get('content-type')?.startsWith('application/json')) return json({ error: 'bad_request' }, 400)
  return null
}

export async function readJson(req: Request): Promise<Record<string, unknown>> {
  try {
    const body = await req.json()
    return body && typeof body === 'object' ? body : {}
  } catch {
    return {}
  }
}

function cookieName(email: string): string {
  return COOKIE_PREFIX + createHash('sha256').update(email.toLowerCase()).digest('hex').slice(0, 16)
}

export function sealCookie(cfg: Config, email: string, refreshToken: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', cfg.key, iv)
  cipher.setAAD(Buffer.from(email.toLowerCase()))
  const data = Buffer.concat([cipher.update(refreshToken, 'utf8'), cipher.final()])
  const value = Buffer.concat([iv, cipher.getAuthTag(), data]).toString('base64url')
  return `${cookieName(email)}=${value}; Path=/api; Max-Age=${MAX_AGE}; HttpOnly; Secure; SameSite=Strict`
}

export function clearCookie(email: string): string {
  return `${cookieName(email)}=; Path=/api; Max-Age=0; HttpOnly; Secure; SameSite=Strict`
}

export function openCookie(cfg: Config, req: Request, email: string): string | null {
  const name = cookieName(email)
  const raw = (req.headers.get('cookie') ?? '')
    .split(';')
    .map((c) => c.trim())
    .find((c) => c.startsWith(name + '='))
    ?.slice(name.length + 1)
  if (!raw) return null
  try {
    const buf = Buffer.from(raw, 'base64url')
    const decipher = createDecipheriv('aes-256-gcm', cfg.key, buf.subarray(0, 12))
    decipher.setAAD(Buffer.from(email.toLowerCase()))
    decipher.setAuthTag(buf.subarray(12, 28))
    return Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString('utf8')
  } catch {
    return null // Tampered with, or SESSION_KEY changed.
  }
}

export interface GoogleTokens {
  access_token?: string
  expires_in?: number
  refresh_token?: string
  scope?: string
  error?: string
}

export async function tokenRequest(params: Record<string, string>): Promise<GoogleTokens> {
  const r = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params),
  })
  return r.json()
}

export async function emailFor(accessToken: string): Promise<string | null> {
  const r = await fetch('https://www.googleapis.com/drive/v3/about?fields=user(emailAddress)', {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!r.ok) return null
  const body = await r.json()
  return body?.user?.emailAddress ?? null
}

export async function revoke(token: string): Promise<void> {
  await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, { method: 'POST' }).catch(() => {})
}
