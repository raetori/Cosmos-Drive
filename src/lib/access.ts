// Where beta access requests go while Google keeps CosmoDrive in testing:
// a form endpoint (Formspree-style JSON POST), else an email address.
export const ACCESS_ENDPOINT = import.meta.env.VITE_ACCESS_REQUEST_ENDPOINT as string | undefined
export const ACCESS_EMAIL = import.meta.env.VITE_ACCESS_REQUEST_EMAIL as string | undefined
export const canRequestAccess = Boolean(ACCESS_ENDPOINT || ACCESS_EMAIL)

/** Where we approve a request: the test-user list of CosmoDrive's Google Cloud project. */
export const AUDIENCE_PAGE = 'https://console.cloud.google.com/auth/audience?project=cosmodrive-512700'
