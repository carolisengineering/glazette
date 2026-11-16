import { expect, test } from 'vitest'
import { layerDetails } from './layerDetails'

test('layerDetails keeps only the fields a layer has', () => {
  expect(layerDetails({})).toEqual({})
  expect(layerDetails({ dips: undefined, note: undefined })).toEqual({})
  expect(layerDetails({ dips: 2, method: 'dip', note: 'rim' })).toEqual({
    dips: 2,
    method: 'dip',
    note: 'rim',
  })
  expect(Object.keys(layerDetails({ method: 'pour' }))).toEqual(['method'])
})

test('layerDetails reads null as missing', () => {
  expect(layerDetails({ dips: null as unknown as number })).toEqual({})
})
