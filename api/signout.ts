import { checkRequest, clearCookie, config, json, openCookie, readJson, revoke } from './_session.js'

/** Forgets an account: revokes its refresh token with Google and deletes the cookie. */
export async function POST(req: Request): Promise<Response> {
  const bad = checkRequest(req)
  if (bad) return bad
  const { email } = await readJson(req)
  if (typeof email !== 'string' || !email) return json({ error: 'bad_request' }, 400)
  const cfg = config()
  const refreshToken = cfg && openCookie(cfg, req, email)
  if (refreshToken) await revoke(refreshToken)
  return json({ ok: true }, 200, { 'Set-Cookie': clearCookie(email) })
}
