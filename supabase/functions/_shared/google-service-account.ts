type GoogleAccessTokenResponse = {
  readonly access_token: string
}

/** Credentials and claims for one Google service-account token exchange. */
export type GoogleServiceAccountTokenConfig = {
  readonly serviceAccountEmail: string
  readonly privateKeyPem: string
  readonly scope: string
  readonly subject?: string
}

function base64url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function importPrivateKey(pem: string): Promise<CryptoKey> {
  const normalized = pem.replace(/\\n/g, '\n')
  const body = normalized
    .replace('-----BEGIN PRIVATE KEY-----', '')
    .replace('-----END PRIVATE KEY-----', '')
    .replace(/\s+/g, '')
  const der = Uint8Array.from(atob(body), character => character.charCodeAt(0))
  return crypto.subtle.importKey(
    'pkcs8',
    der,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  )
}

function parseAccessToken(value: unknown): GoogleAccessTokenResponse | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const accessToken = Reflect.get(value, 'access_token')
  return typeof accessToken === 'string' && accessToken.length > 0
    ? { access_token: accessToken }
    : null
}

/** Exchange a signed service-account JWT for a scoped Google access token. */
export async function googleServiceAccountAccessToken(
  config: GoogleServiceAccountTokenConfig,
): Promise<string> {
  const encoder = new TextEncoder()
  const now = Math.floor(Date.now() / 1000)
  const header = base64url(encoder.encode(JSON.stringify({ alg: 'RS256', typ: 'JWT' })))
  const claims = base64url(encoder.encode(JSON.stringify({
    iss: config.serviceAccountEmail,
    scope: config.scope,
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
    ...(config.subject === undefined ? {} : { sub: config.subject }),
  })))
  const unsigned = `${header}.${claims}`
  const key = await importPrivateKey(config.privateKeyPem)
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, encoder.encode(unsigned))
  const assertion = `${unsigned}.${base64url(new Uint8Array(signature))}`

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  })
  if (!response.ok) throw new Error(`google_token_exchange_failed:${response.status}`)

  const token = parseAccessToken(await response.json())
  if (!token) throw new Error('google_token_response_invalid')
  return token.access_token
}
