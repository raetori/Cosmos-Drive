import { checkRequest, clearCookie, config, json, openCookie, readJson, tokenRequest } from './_session.js'

/** A fresh one-hour access token for an account signed in through the server, without any popup. */
export async function POST(req: Request): Promise<Response> {
  const bad = checkRequest(req)
  if (bad) return bad
  const cfg = config()
  if (!cfg) return json({ error: 'not_configured' }, 503)
  const { email } = await readJson(req)
  if (typeof email !== 'string' || !email) return json({ error: 'bad_request' }, 400)
  const refreshToken = openCookie(cfg, req, email)
  if (!refreshToken) return json({ error: 'signed_out' }, 401)

  const t = await tokenRequest({
    refresh_token: refreshToken,
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    grant_type: 'refresh_token',
  })
  if (t.access_token) return json({ access_token: t.access_token, expires_in: t.expires_in ?? 3600 })
  if (t.error === 'invalid_grant') {
    // Revoked, password changed, or (while the app is in Google's testing mode) a week old.
    return json({ error: 'signed_out' }, 401, { 'Set-Cookie': clearCookie(email) })
  }
  return json({ error: t.error ?? 'refresh_failed' }, 502)
}
