/** Set on the request in middleware so the root layout can read the URL without trusting client paths. */
export const PREVIEW_PATH_HEADER = 'x-ft-preview-path'

/** Cookie name for preview/staging gate (HTTP-only). */
export const PREVIEW_ACCESS_COOKIE = 'ft_preview_access'

export const PREVIEW_ACCESS_COOKIE_MAX_AGE = 60 * 60 * 24 * 30 // 30 days

const PREVIEW_TOKEN_PREFIX = 'flextimer-preview:v1:'

/**
 * Deterministic token stored in the cookie after a successful unlock.
 * Matches Edge (middleware) and Node (API route) via Web Crypto.
 */
export async function previewAccessToken(secret: string): Promise<string> {
  const data = new TextEncoder().encode(`${PREVIEW_TOKEN_PREFIX}${secret}`)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export function isLocalhostHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  return h === 'localhost' || h === '127.0.0.1' || h === '::1' || h.endsWith('.localhost')
}
