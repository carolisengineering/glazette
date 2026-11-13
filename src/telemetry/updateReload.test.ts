import { consumeUpdateReload, markUpdateReload } from './updateReload'

const KEY = 'glazette:update-reload'

beforeEach(() => sessionStorage.removeItem(KEY))
afterEach(() => sessionStorage.removeItem(KEY))

test('a mark consumed within 60 seconds is true, and only once', () => {
  markUpdateReload(sessionStorage, 1000)
  expect(consumeUpdateReload(sessionStorage, 50_000)).toBe(true)
  expect(consumeUpdateReload(sessionStorage, 50_000)).toBe(false)
})

test('a mark older than 60 seconds is false and is cleared', () => {
  markUpdateReload(sessionStorage, 0)
  expect(consumeUpdateReload(sessionStorage, 60_001)).toBe(false)
  expect(sessionStorage.getItem(KEY)).toBeNull()
})

test('no mark is false', () => {
  expect(consumeUpdateReload(sessionStorage, 1000)).toBe(false)
})

test("a value that isn't a number is false and is cleared", () => {
  sessionStorage.setItem(KEY, 'soon')
  expect(consumeUpdateReload(sessionStorage, 1000)).toBe(false)
  expect(sessionStorage.getItem(KEY)).toBeNull()
})

test('a throwing storage never throws', () => {
  const boom = () => {
    throw new Error('storage failed')
  }
  const stub = {
    getItem: boom,
    setItem: boom,
    removeItem: boom,
  } as unknown as Storage
  expect(() => markUpdateReload(stub)).not.toThrow()
  expect(consumeUpdateReload(stub)).toBe(false)
})

test('blocked site data (sessionStorage getter throws) never throws', () => {
  const spy = vi
    .spyOn(window, 'sessionStorage', 'get')
    .mockImplementation(() => {
      throw new Error('blocked')
    })
  try {
    expect(() => markUpdateReload()).not.toThrow()
    expect(consumeUpdateReload()).toBe(false)
  } finally {
    spy.mockRestore()
  }
})

test('a mark dated in the future is false and is cleared', () => {
  markUpdateReload(sessionStorage, 100_000)
  expect(consumeUpdateReload(sessionStorage, 50_000)).toBe(false)
  expect(sessionStorage.getItem(KEY)).toBeNull()
})
