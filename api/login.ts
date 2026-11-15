import { DRIVE_SCOPE, config, newState, redirect, siteOrigin } from './_session.js'

/** Starts a full-page Google sign-in. The app links here; Google sends the person back to /api/callback. */
export function GET(req: Request): Response {
  const cfg = config()
  if (!cfg) return redirect('/#signin-error=not_configured')
  const { state, cookie } = newState()
  const auth = new URL('https://accounts.google.com/o/oauth2/v2/auth')
  auth.search = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: `${siteOrigin(req)}/api/callback`,
    response_type: 'code',
    scope: DRIVE_SCOPE,
    access_type: 'offline',
    // consent: always hand back a refresh token, even for accounts that allowed the app before.
    prompt: 'select_account consent',
    include_granted_scopes: 'true',
    state,
  }).toString()
  return redirect(auth.toString(), [cookie])
}
