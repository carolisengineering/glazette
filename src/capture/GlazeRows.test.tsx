import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
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
