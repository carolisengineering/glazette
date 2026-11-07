import { createHash, createHmac } from 'node:crypto'
import { hmacHex, randomCode, randomToken, sameHex, sha256Hex } from './crypto'

describe('randomCode', () => {
  it('is always 6 digits and rarely repeats', () => {
    const codes = Array.from({ length: 1000 }, () => randomCode())
    for (const c of codes) expect(c).toMatch(/^\d{6}$/)
    expect(new Set(codes).size).toBeGreaterThanOrEqual(900)
  })
})

describe('randomToken', () => {
  it('is 43 base64url characters and differs each call', () => {
    const a = randomToken()
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(randomToken()).not.toBe(a)
  })
})

describe('hashing', () => {
  it('hmacHex matches node HMAC-SHA-256', async () => {
    const expected = createHmac('sha256', 'k').update('m').digest('hex')
    expect(await hmacHex('k', 'm')).toBe(expected)
  })

  it('sha256Hex matches the known digest', async () => {
    const hex =
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
    expect(await sha256Hex('abc')).toBe(hex)
    expect(createHash('sha256').update('abc').digest('hex')).toBe(hex)
  })
})

describe('sameHex', () => {
  it('compares whole strings', () => {
    expect(sameHex('ab', 'ab')).toBe(true)
    expect(sameHex('ab', 'ac')).toBe(false)
    expect(sameHex('ab', 'abc')).toBe(false)
  })
})
