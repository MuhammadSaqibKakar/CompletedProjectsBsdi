import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
import { defaultPasswordHash } from './admin-credential.js'

const deriveKey = promisify(scrypt)
export const hashToken = (value) => createHash('sha256').update(value).digest('hex')
export const sessionLifetime = 8 * 60 * 60 * 1000
export const randomToken = () => randomBytes(32).toString('base64url')

export function validatePasswordHash(encoded) {
  if (!/^scrypt\$[a-f0-9]{64}\$[a-f0-9]{128}$/.test(encoded)) {
    throw new Error('Admin password verifier is not configured correctly.')
  }
  return encoded
}

export async function verifyPassword(password, encoded = process.env.ADMIN_PASSWORD_HASH || defaultPasswordHash) {
  validatePasswordHash(encoded)
  if (typeof password !== 'string' || password.length > 256 || password.length < 1) return false
  const [, salt, expected] = encoded.split('$')
  const actual = await deriveKey(password, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 })
  return timingSafeEqual(Buffer.from(expected, 'hex'), actual)
}

export function safeEqual(actual, expected) {
  if (typeof actual !== 'string' || typeof expected !== 'string') return false
  const a = Buffer.from(actual)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

export function readCookie(req, name) {
  const pairs = String(req.headers.cookie || '').split(';')
  const values = pairs.filter((part) => part.trim().startsWith(`${name}=`))
  if (values.length !== 1) return ''
  const token = values[0].trim().slice(name.length + 1)
  return /^[A-Za-z0-9_-]{43}$/.test(token) ? token : ''
}
