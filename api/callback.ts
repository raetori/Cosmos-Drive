import {
  DRIVE_SCOPE,
  clearState,
  config,
  emailFor,
  redirect,
  sealCookie,
  signedInCookie,
  siteOrigin,
  stateMatches,
  tokenRequest,
} from './_session.js'

const fail = (reason: string) => redirect(`/#signin-error=${encodeURIComponent(reason)}`, [clearState])

/** Google sends the person back here after the full-page sign-in. */
export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url)
  const error = url.searchParams.get('error')
  if (error) return fail(error) // e.g. access_denied when someone presses Cancel
  if (!stateMatches(req, url.searchParams.get('state'))) return fail('expired')
  const cfg = config()
  if (!cfg) return fail('not_configured')
  const code = url.searchParams.get('code')
  if (!code) return fail('no_code')

  const t = await tokenRequest({
    code,
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    redirect_uri: `${siteOrigin(req)}/api/callback`,
    grant_type: 'authorization_code',
  })
  if (!t.access_token) return fail(t.error ?? 'exchange_failed')
  if (!t.scope?.split(' ').includes(DRIVE_SCOPE)) return fail('scope_denied')
  if (!t.refresh_token) return fail('no_refresh_token')
  const email = await emailFor(t.access_token)
  if (!email) return fail('profile_failed')
  return redirect('/', [clearState, sealCookie(cfg, email, t.refresh_token), signedInCookie(email)])
}
