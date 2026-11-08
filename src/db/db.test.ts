import { db } from './db'

beforeEach(async () => {
  await db.delete()
  await db.open()
})

const SYNCED = ['pieces', 'entries', 'glazeApps', 'glazes', 'clays', 'settings']

test('schema has the eight tables and compound index entries.[pieceId+date]', () => {
  expect(db.tables.map((t) => t.name).sort()).toEqual(
    [...SYNCED, 'photos', 'syncState'].sort(),
  )
  const indexes = db.table('entries').schema.indexes.map((i) => i.name)
  expect(indexes).toContain('[pieceId+date]')
})

test('version 3 indexes dirty on the six synced tables only', () => {
  expect(db.verno).toBe(3)
  for (const name of SYNCED) {
    const indexes = db.table(name).schema.indexes.map((i) => i.name)
    expect(indexes, name).toContain('dirty')
  }
  const photoIndexes = db.table('photos').schema.indexes.map((i) => i.name)
  expect(photoIndexes).not.toContain('dirty')
  expect(db.table('syncState').schema.primKey.name).toBe('id')
})
