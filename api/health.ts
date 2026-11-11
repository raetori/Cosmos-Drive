import { config, json } from './_session.js'

/** Tells the app whether the server can keep people signed in (all keys are set). */
export function GET(): Response {
  return json({ staySignedIn: config() !== null })
}
