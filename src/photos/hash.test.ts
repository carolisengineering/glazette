import { sha256 } from './hash'

const bytes = (s: string) => new Blob([s])

test('sha256 of the same bytes is stable and 64 lowercase hex chars', async () => {
  const a = await sha256(bytes('clay'))
  const b = await sha256(bytes('clay'))
  expect(a).toBe(b)
  expect(a).toMatch(/^[0-9a-f]{64}$/)
})

test('sha256 matches a known digest and differs for different bytes', async () => {
  expect(await sha256(bytes('abc'))).toBe(
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
  )
  expect(await sha256(bytes('abd'))).not.toBe(await sha256(bytes('abc')))
})
