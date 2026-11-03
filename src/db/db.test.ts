import { db } from './db'

beforeEach(async () => {
  await db.delete()
  await db.open()
})

test('schema has the seven tables and compound index entries.[pieceId+date]', () => {
  expect(db.tables.map((t) => t.name).sort()).toEqual(
    [
      'clays',
      'entries',
      'glazeApps',
      'glazes',
      'photos',
      'pieces',
      'settings',
    ].sort(),
  )
  const indexes = db.table('entries').schema.indexes.map((i) => i.name)
  expect(indexes).toContain('[pieceId+date]')
})
