import { expect, test } from 'vitest'
import type { SyncRecord } from '../../shared/syncProtocol'
import { sha256 } from '../photos/hash'
import { createTestPhotoServer } from '../sync/testPhotoServer'
import { createTestServer } from '../sync/testServer'
import { countingPhotoTransport, countingTransport } from './counting'

test('counts pushed and pulled records', async () => {
  const server = createTestServer()
  const { transport, counts } = countingTransport(server)
  const records: SyncRecord[] = [1, 2].map((n) => ({
    kind: 'glaze',
    id: `g${n}`,
    changedAt: '2026-11-10T00:00:00.000Z',
    data: { id: `g${n}`, name: `G${n}` },
  }))
  await transport.push(records)
  const res = await transport.pull(0)
  expect(counts()).toEqual({ pushed: 2, pulled: res.records.length })
  expect(res.records.length).toBeGreaterThan(0)
})

test('counts full-photo uploads and bytes, not thumbnails', async () => {
  const server = createTestPhotoServer()
  const { transport, counts } = countingPhotoTransport(server)
  const full = new Blob(['full-bytes'])
  const thumb = new Blob(['th'])
  const hash = await sha256(full)
  expect(await transport.upload(hash, 'full', full, hash)).toBe('stored')
  expect(
    await transport.upload(hash, 'thumb', thumb, await sha256(thumb)),
  ).toBe('stored')
  // Refused bytes don't count.
  expect(await transport.upload('x', 'full', thumb, 'x')).toBe('refused')
  expect(counts()).toEqual({ uploaded: 1, downloaded: 0, bytes: 12 })

  expect(await transport.download(hash, 'full')).not.toBeNull()
  expect(await transport.download('nope', 'full')).toBeNull()
  expect(await transport.download(hash, 'thumb')).not.toBeNull()
  expect(counts()).toEqual({ uploaded: 1, downloaded: 1, bytes: 24 })
})
