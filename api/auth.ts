import { DRIVE_SCOPE, checkRequest, config, emailFor, json, readJson, revoke, sealCookie, tokenRequest } from './_session.js'

/** Swaps the one-time code from Google's sign-in popup for tokens, and keeps the refresh token in a cookie. */
export async function POST(req: Request): Promise<Response> {
  const bad = checkRequest(req)
  if (bad) return bad
  const cfg = config()
  if (!cfg) return json({ error: 'not_configured' }, 503)
  const { code } = await readJson(req)
  if (typeof code !== 'string' || !code) return json({ error: 'bad_request' }, 400)

  const t = await tokenRequest({
    code,
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    redirect_uri: 'postmessage',
    grant_type: 'authorization_code',
  })
  if (!t.access_token) return json({ error: t.error ?? 'exchange_failed' }, 400)
  if (!t.scope?.split(' ').includes(DRIVE_SCOPE)) return json({ error: 'scope_denied' }, 403)
  const email = await emailFor(t.access_token)
  if (!email) return json({ error: 'profile_failed' }, 400)

  if (!t.refresh_token) {
    // Google only hands out a refresh token the first time someone allows the app. If they
    // allowed it before (with the old one-hour sign-in), drop that grant so the next sign-in
    // asks again and comes back with one.
    await revoke(t.access_token)
    return json({ error: 'needs_consent', email }, 409)
  }
  return json({ access_token: t.access_token, expires_in: t.expires_in ?? 3600, email }, 200, {
    'Set-Cookie': sealCookie(cfg, email, t.refresh_token),
  })
}
