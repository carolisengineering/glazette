import { saveFile } from './saveFile'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const blob = new Blob(['x'], { type: 'application/zip' })

test('saveFile shares the file when the browser can share files', async () => {
  const share = vi.fn().mockResolvedValue(undefined)
  vi.stubGlobal('navigator', { share, canShare: () => true })
  expect(await saveFile(blob, 'a.zip')).toBe('shared')
  const arg = share.mock.calls[0][0] as { files: File[] }
  expect(arg.files[0].name).toBe('a.zip')
  expect(arg.files[0].type).toBe('application/zip')
})

test('saveFile reports a dismissed share sheet as canceled', async () => {
  const share = vi.fn().mockRejectedValue(new DOMException('no', 'AbortError'))
  vi.stubGlobal('navigator', { share, canShare: () => true })
  expect(await saveFile(blob, 'a.zip')).toBe('canceled')
})

test('saveFile rethrows other share failures', async () => {
  const share = vi.fn().mockRejectedValue(new Error('boom'))
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
  expect(revoke).toHaveBeenCalledWith('blob:x')
})
