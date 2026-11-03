import { fitWithin } from './fit'

test('fitWithin scales the long edge down to max', () => {
  expect(fitWithin(4000, 3000, 2000)).toEqual({ w: 2000, h: 1500 })
  expect(fitWithin(3000, 4000, 2000)).toEqual({ w: 1500, h: 2000 })
})

test('fitWithin never upscales', () => {
  expect(fitWithin(800, 600, 2000)).toEqual({ w: 800, h: 600 })
})
