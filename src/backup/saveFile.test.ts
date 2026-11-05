import { saveFile } from './saveFile'

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

/** matchMedia stub: true means a touch device ((pointer: coarse)). */
const stubPointer = (coarse: boolean) =>
  vi.stubGlobal('matchMedia', (q: string) => ({
    matches: q === '(pointer: coarse)' && coarse,
  }))

const blob = new Blob(['x'], { type: 'application/zip' })

test('saveFile shares the file when the browser can share files', async () => {
  const share = vi.fn().mockResolvedValue(undefined)
  stubPointer(true)
  vi.stubGlobal('navigator', { share, canShare: () => true })
  expect(await saveFile(blob, 'a.zip')).toBe('shared')
  const arg = share.mock.calls[0][0] as { files: File[] }
  expect(arg.files[0].name).toBe('a.zip')
  expect(arg.files[0].type).toBe('application/zip')
})

test('saveFile reports a dismissed share sheet as canceled', async () => {
  const share = vi.fn().mockRejectedValue(new DOMException('no', 'AbortError'))
  stubPointer(true)
  vi.stubGlobal('navigator', { share, canShare: () => true })
  expect(await saveFile(blob, 'a.zip')).toBe('canceled')
})

test('saveFile rethrows other share failures', async () => {
  const share = vi.fn().mockRejectedValue(new Error('boom'))
  stubPointer(true)
  vi.stubGlobal('navigator', { share, canShare: () => true })
  await expect(saveFile(blob, 'a.zip')).rejects.toThrow('boom')
})

test('saveFile falls back to a download when files cannot be shared', async () => {
  vi.stubGlobal('navigator', { canShare: () => false })
  const create = vi.fn().mockReturnValue('blob:x')
  const revoke = vi.fn()
  vi.stubGlobal(
    'URL',
    Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke }),
  )
  const click = vi
    .spyOn(HTMLAnchorElement.prototype, 'click')
    .mockImplementation(function (this: HTMLAnchorElement) {
      expect(this.download).toBe('a.zip')
      expect(this.href).toBe('blob:x')
    })
  expect(await saveFile(blob, 'a.zip')).toBe('downloaded')
  expect(click).toHaveBeenCalled()
  expect(revoke).not.toHaveBeenCalled()
  vi.advanceTimersByTime(1000)
  expect(revoke).toHaveBeenCalledWith('blob:x')
})

test('saveFile reports a refused share (lapsed tap) as blocked', async () => {
  const share = vi
    .fn()
    .mockRejectedValue(new DOMException('no', 'NotAllowedError'))
  stubPointer(true)
  vi.stubGlobal('navigator', { share, canShare: () => true })
  expect(await saveFile(blob, 'a.zip')).toBe('blocked')
})

test('saveFile downloads on a desktop (fine pointer) even when files can be shared', async () => {
  const share = vi.fn()
  stubPointer(false)
  vi.stubGlobal('navigator', { share, canShare: () => true })
  vi.stubGlobal(
    'URL',
    Object.assign(URL, {
      createObjectURL: vi.fn().mockReturnValue('blob:x'),
      revokeObjectURL: vi.fn(),
    }),
  )
  const click = vi
    .spyOn(HTMLAnchorElement.prototype, 'click')
    .mockImplementation(() => {})
  expect(await saveFile(blob, 'a.zip')).toBe('downloaded')
  expect(share).not.toHaveBeenCalled()
  expect(click).toHaveBeenCalled()
})

test('saveFile downloads when matchMedia is missing', async () => {
  const share = vi.fn()
  vi.stubGlobal('matchMedia', undefined)
  vi.stubGlobal('navigator', { share, canShare: () => true })
  vi.stubGlobal(
    'URL',
    Object.assign(URL, {
      createObjectURL: vi.fn().mockReturnValue('blob:x'),
      revokeObjectURL: vi.fn(),
    }),
  )
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  expect(await saveFile(blob, 'a.zip')).toBe('downloaded')
  expect(share).not.toHaveBeenCalled()
})
