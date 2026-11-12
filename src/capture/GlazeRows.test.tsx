import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { db } from '../db/db'
import { type GlazeRow, GlazeRows } from './GlazeRows'

beforeEach(async () => {
  await db.delete()
  await db.open()
})

const rows = (...names: string[]): GlazeRow[] =>
  names.map((name) => ({ key: name, name }))

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
