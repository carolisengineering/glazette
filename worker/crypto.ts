const encoder = new TextEncoder()

// Largest multiple of 1,000,000 below 2^32. Values at or above it are
// rejected so every 6-digit code is equally likely.
const CODE_LIMIT = 4_294_000_000

export function randomCode(): string {
  const draw = new Uint32Array(1)
  do {
    crypto.getRandomValues(draw)
  } while (draw[0] >= CODE_LIMIT)
  return String(draw[0] % 1_000_000).padStart(6, '0')
}

export function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('')
}

// The imported key for the last secret seen, so each hash doesn't import it again.
let hmacKey: { secret: string; key: Promise<CryptoKey> } | undefined

function keyFor(secret: string): Promise<CryptoKey> {
  if (hmacKey?.secret !== secret) {
    const key = crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    )
    hmacKey = { secret, key }
  }
  return hmacKey.key
}

export async function hmacHex(secret: string, data: string): Promise<string> {
  const key = await keyFor(secret)
  return toHex(await crypto.subtle.sign('HMAC', key, encoder.encode(data)))
}

export async function sha256Hex(data: string): Promise<string> {
  return toHex(await crypto.subtle.digest('SHA-256', encoder.encode(data)))
}

export function sameHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}
