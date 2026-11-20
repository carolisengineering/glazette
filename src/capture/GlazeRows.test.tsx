import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { comboId } from '../db/combos'
import { db } from '../db/db'
import { type GlazeRow, GlazeRows, isBlankRow, rowsAreBlank } from './GlazeRows'

beforeEach(async () => {
  await db.delete()
  await db.open()
})

const rows = (...names: string[]): GlazeRow[] =>
  names.map((name) => ({ key: name, name }))

test('a row is blank with no glaze picked and no name typed', () => {
  expect(isBlankRow({ key: 'a', name: '  ' })).toBe(true)
  expect(isBlankRow({ key: 'a', name: 'Celadon' })).toBe(false)
  expect(isBlankRow({ key: 'a', name: '', glazeId: 'g' })).toBe(false)
  expect(rowsAreBlank(rows('', ' '))).toBe(true)
  expect(rowsAreBlank(rows('', 'Shino'))).toBe(false)
})

describe('GlazeRows move buttons', () => {
  it('moving glaze 2 up swaps the first two rows', async () => {
    const onChange = vi.fn()
    render(<GlazeRows value={rows('A', 'B', 'C')} onChange={onChange} />)
    await userEvent.click(
      screen.getByRole('button', { name: 'Move glaze 2 up' }),
    )
    expect(onChange.mock.calls[0][0].map((r: GlazeRow) => r.name)).toEqual([
      'B',
      'A',
      'C',
    ])
  })

  it('moving glaze 2 down swaps it with the third', async () => {
    const onChange = vi.fn()
    render(<GlazeRows value={rows('A', 'B', 'C')} onChange={onChange} />)
    await userEvent.click(
      screen.getByRole('button', { name: 'Move glaze 2 down' }),
    )
    expect(onChange.mock.calls[0][0].map((r: GlazeRow) => r.name)).toEqual([
      'A',
      'C',
      'B',
    ])
  })

  it("the ends can't move past the edge", () => {
    render(<GlazeRows value={rows('A', 'B', 'C')} onChange={() => {}} />)
    expect(
      screen.getByRole('button', { name: 'Move glaze 1 up' }),
    ).toBeDisabled()
    expect(
      screen.getByRole('button', { name: 'Move glaze 3 down' }),
    ).toBeDisabled()
    expect(
      screen.getByRole('button', { name: 'Move glaze 1 down' }),
    ).toBeEnabled()
  })

  it('a single row has no arrows', () => {
    render(<GlazeRows value={rows('A')} onChange={() => {}} />)
    expect(screen.queryByRole('button', { name: /Move glaze/ })).toBeNull()
  })
})

it('a lone layer whose glaze has not synced yet can still be removed', () => {
  render(
    <GlazeRows
      value={[{ key: 'k', glazeId: 'gMissing', name: '' }]}
      onChange={() => {}}
    />,
  )
  expect(
    screen.getByRole('button', { name: 'Remove glaze 1' }),
  ).toBeInTheDocument()
})

function Harness() {
  const [value, setValue] = useState<GlazeRow[]>(rows(''))
  return <GlazeRows value={value} onChange={setValue} />
}

describe('GlazeRows tile grid', () => {
  const seed = async (n: number) => {
    for (let i = 0; i < n; i++) {
      await db.glazes.add({
        id: `g${i}`,
        name: `Glaze ${String(i).padStart(2, '0')}`,
        color: '#aabbcc',
      })
    }
  }
  const tiles = () => screen.getAllByRole('button', { name: /^Glaze \d\d$/ })

  it('an empty row shows every live glaze as a tile, not just six', async () => {
    await seed(11)
    render(<Harness />)
    await waitFor(() => expect(tiles()).toHaveLength(11))
  })

  it('typing narrows the tiles', async () => {
    await seed(11)
    render(<Harness />)
    await waitFor(() => expect(tiles()).toHaveLength(11))
    await userEvent.type(screen.getByLabelText('Glaze 1'), 'Glaze 03')
    await waitFor(() => expect(tiles()).toHaveLength(1))
  })

  it('tapping a tile picks that glaze', async () => {
    await seed(3)
    render(<Harness />)
    await userEvent.click(
      await screen.findByRole('button', { name: 'Glaze 02' }),
    )
    expect(screen.getByLabelText('Glaze 1')).toHaveValue('Glaze 02')
    expect(screen.queryByRole('button', { name: 'Glaze 01' })).toBeNull()
  })

  it("a picked row shows its glaze's swatch next to the name", async () => {
    await seed(2)
    render(<Harness />)
    expect(screen.queryByTestId('picked-swatch')).toBeNull()
    await userEvent.click(
      await screen.findByRole('button', { name: 'Glaze 01' }),
    )
    expect(screen.getByTestId('picked-swatch')).toBeInTheDocument()
  })
})

describe('GlazeRows combos', () => {
  const addGlaze = (id: string, name: string, extra = {}) =>
    db.glazes.add({ id, name, color: '#aabbcc', ...extra })
  const addCombo = (layers: string[]) =>
    db.combos.add({ id: comboId(layers), layers, swatchPhotoId: 'p' })
  const browse = () => screen.findByRole('button', { name: 'Browse combos' })

  it('Browse combos shows only when a combo is shown', async () => {
    await addGlaze('t', 'Tenmoku')
    await addGlaze('c', 'Celadon', { deletedAt: '2026-11-01' })
    render(<GlazeRows value={rows('')} onChange={() => {}} />)
    await screen.findByRole('button', { name: 'Tenmoku' })
    expect(screen.queryByRole('button', { name: 'Browse combos' })).toBeNull()
    await addCombo(['c', 't'])
    await new Promise((r) => setTimeout(r, 50))
    expect(screen.queryByRole('button', { name: 'Browse combos' })).toBeNull()
    await db.glazes.update('c', { deletedAt: undefined })
    expect(await browse()).toBeInTheDocument()
  })

  it('tapping a combo fills the rows top first', async () => {
    await addGlaze('t', 'Tenmoku')
    await addGlaze('c', 'Celadon')
    await addGlaze('h', 'Chun')
    await addCombo(['h', 'c', 't'])
    const onChange = vi.fn()
    render(<GlazeRows value={rows('')} onChange={onChange} />)
    await userEvent.click(await browse())
    await userEvent.click(
      await screen.findByRole('button', {
        name: 'Chun over Celadon over Tenmoku',
      }),
    )
    const next = onChange.mock.calls[0][0] as GlazeRow[]
    expect(next.map((r) => [r.glazeId, r.name])).toEqual([
      ['h', 'Chun'],
      ['c', 'Celadon'],
      ['t', 'Tenmoku'],
    ])
    for (const r of next) {
      expect(r.dips).toBeUndefined()
      expect(r.method).toBeUndefined()
      expect(r.note).toBeUndefined()
    }
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('filling blank rows shows no toast', async () => {
    await addGlaze('t', 'Tenmoku')
    await addGlaze('c', 'Celadon')
    await addCombo(['c', 't'])
    render(<GlazeRows value={rows('')} onChange={() => {}} />)
    await userEvent.click(await browse())
    await userEvent.click(
      await screen.findByRole('button', { name: 'Celadon over Tenmoku' }),
    )
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('undo restores the rows exactly', async () => {
    await addGlaze('t', 'Tenmoku')
    await addGlaze('c', 'Celadon')
    await addCombo(['c', 't'])
    const original: GlazeRow[] = [
      {
        key: 'k1',
        glazeId: 't',
        name: 'Tenmoku',
        dips: 2,
        method: 'brush',
        note: 'thin',
      },
    ]
    const onChange = vi.fn()
    render(<GlazeRows value={original} onChange={onChange} />)
    await userEvent.click(await browse())
    await userEvent.click(
      await screen.findByRole('button', { name: 'Celadon over Tenmoku' }),
    )
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Glazes set to Celadon over Tenmoku',
    )
    await userEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(onChange).toHaveBeenLastCalledWith(original)
  })
})
