import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { PieceDetail } from '../db/queries'
import { FactCards } from './FactCards'

function detail(over: Partial<PieceDetail> = {}): PieceDetail {
  return {
    piece: { id: 'p', createdAt: '2026-11-01', updatedAt: '2026-11-01' },
    entries: [],
    clayName: 'White stoneware',
    glazeNames: [],
    glazeLayers: [],
    glazeLayerCount: 0,
    planLayers: [],
    cone: '6',
    ...over,
  }
}

function layers(...pairs: Array<[string, string]>) {
  return {
    glazeNames: pairs.map(([name]) => name),
    glazeLayers: pairs.map(([name, color]) => ({ name, color })),
  }
}

test('the glaze box comes before clay and firing', () => {
  render(<FactCards view={detail()} onPlan={() => {}} />)
  const [glaze, clay, firing] = ['Glaze', 'Clay', 'Firing'].map((l) =>
    screen.getByText(l),
  )
  expect(glaze.compareDocumentPosition(clay)).toBe(
    Node.DOCUMENT_POSITION_FOLLOWING,
  )
  expect(clay.compareDocumentPosition(firing)).toBe(
    Node.DOCUMENT_POSITION_FOLLOWING,
  )
})

test('glazes are a list, one item and one dot in its own color per layer, in order', () => {
  render(
    <FactCards
      view={detail(
        layers(
          ['Celadon', '#8FB3A3'],
          ['Floating Blue', '#3F6F9A'],
          ['Tenmoku', '#4A2F22'],
        ),
      )}
      onPlan={() => {}}
    />,
  )
  const list = screen.getByRole('list', { name: 'Glazes' })
  const items = within(list).getAllByRole('listitem')
  expect(items.map((i) => i.textContent)).toEqual([
    'Celadon',
    'Floating Blue',
    'Tenmoku',
  ])
  expect(
    screen.getAllByTestId('glaze-dot').map((d) => d.style.backgroundColor),
  ).toEqual(['rgb(143, 179, 163)', 'rgb(63, 111, 154)', 'rgb(74, 47, 34)'])
})

test('used glazes show dips, method and note in muted detail text', () => {
  render(
    <FactCards
      view={detail({
        glazeLayers: [
          { name: 'Rutile Blue', color: '#3d6b8c', dips: 3 },
          { name: 'Tenmoku', color: '#4a2c1c', method: 'pour', note: 'inside' },
          { name: 'Shino', color: '#c9b98d', dips: 1, method: 'brush' },
        ],
      })}
      onPlan={() => {}}
    />,
  )
  const items = within(
    screen.getByRole('list', { name: 'Glazes' }),
  ).getAllByRole('listitem')
  expect(items.map((i) => i.textContent)).toEqual([
    'Rutile Blue · 3 dips',
    'Tenmoku · poured · inside',
    'Shino · 1 dip · brushed',
  ])
})

test('the method reads dipped only when there is no dip count to say it', () => {
  render(
    <FactCards
      view={detail({
        glazeLayers: [
          { name: 'Celadon', color: '#8fb3a3', method: 'dip' },
          { name: 'Rutile Blue', color: '#3d6b8c', dips: 2, method: 'dip' },
          { name: 'Shino', color: '#c9b98d', method: 'spray', note: 'rim' },
        ],
      })}
      onPlan={() => {}}
    />,
  )
  expect(screen.getAllByRole('listitem').map((i) => i.textContent)).toEqual([
    'Celadon · dipped',
    'Rutile Blue · 2 dips',
    'Shino · sprayed · rim',
  ])
})

test('plan rows show the method too, with a retired glaze marked', () => {
  render(
    <FactCards
      view={detail({
        stage: 'bisqued',
        planLayers: [
          { glazeId: 'g1', name: 'Shino', color: '#c9b98d', method: 'pour' },
          { glazeId: 'g2', name: 'Celadon', color: '#9dbbaa', retired: true },
        ],
      })}
      onPlan={() => {}}
    />,
  )
  expect(
    within(screen.getByRole('list', { name: 'Glaze plan' }))
      .getAllByRole('listitem')
      .map((li) => li.textContent),
  ).toEqual(['Shino · poured', 'Celadon (retired)'])
})

test('plan rings carry a faint outline so white glazes stay visible', () => {
  render(
    <FactCards
      view={detail({
        stage: 'bisqued',
        planLayers: [{ glazeId: 'g1', name: 'White', color: '#ffffff' }],
      })}
      onPlan={() => {}}
    />,
  )
  expect(screen.getByTestId('plan-ring').className).toContain(
    'shadow-[0_0_0_1px',
  )
})

test('two layers of the same glaze both show', () => {
  render(
    <FactCards
      view={detail(layers(['Celadon', '#8FB3A3'], ['Celadon', '#8FB3A3']))}
      onPlan={() => {}}
    />,
  )
  expect(screen.getAllByRole('listitem')).toHaveLength(2)
})

test('an unglazed piece says so, with no list and no dot', () => {
  render(<FactCards view={detail()} onPlan={() => {}} />)
  expect(screen.getByText('Not glazed yet')).toBeVisible()
  expect(screen.queryByRole('list')).toBeNull()
  expect(screen.queryByTestId('glaze-dot')).toBeNull()
})

test('nothing in the boxes clips long clay and glaze names', () => {
  const { container } = render(
    <FactCards
      view={detail({
        clayName: 'Speckled buff stoneware',
        ...layers(['Floating Blue over Shino', '#3F6F9A']),
      })}
      onPlan={() => {}}
    />,
  )
  const clipping =
    /\b(truncate|overflow-hidden|whitespace-nowrap|line-clamp-\d+|text-ellipsis)\b/
  for (const el of container.querySelectorAll('*')) {
    expect(el.getAttribute('class') ?? '').not.toMatch(clipping)
  }
  expect(screen.getByText('Speckled buff stoneware')).toBeVisible()
  expect(screen.getByText('Floating Blue over Shino')).toBeVisible()
})

test('an unglazed piece at Bisqued offers to plan glazes', async () => {
  const onPlan = vi.fn()
  render(<FactCards view={detail({ stage: 'bisqued' })} onPlan={onPlan} />)
  expect(screen.getByText('Not glazed yet')).toBeVisible()
  await userEvent.click(screen.getByRole('button', { name: '+ Plan glazes' }))
  expect(onPlan).toHaveBeenCalled()
})

test('a Fired piece without glazes or a plan offers no plan', () => {
  render(<FactCards view={detail({ stage: 'fired' })} onPlan={() => {}} />)
  expect(screen.queryByRole('button', { name: '+ Plan glazes' })).toBeNull()
})

test('a plan shows as a plan, with rings, dips and notes, and skips nameless layers', async () => {
  const onPlan = vi.fn()
  render(
    <FactCards
      view={detail({
        stage: 'bisqued',
        planLayers: [
          { glazeId: 'g1', name: 'Rutile Blue', color: '#3d6b8c', dips: 2 },
          { glazeId: 'gone', name: '', color: '#cccccc' },
          {
            glazeId: 'g2',
            name: 'Shino',
            color: '#c9b98d',
            dips: 1,
            note: 'rim only',
          },
        ],
      })}
      onPlan={onPlan}
    />,
  )
  const list = screen.getByRole('list', { name: 'Glaze plan' })
  expect(
    within(list)
      .getAllByRole('listitem')
      .map((li) => li.textContent),
  ).toEqual(['Rutile Blue · 2 dips', 'Shino · 1 dip · rim only'])
  expect(screen.getAllByTestId('plan-ring')).toHaveLength(2)
  expect(screen.queryByTestId('glaze-dot')).toBeNull()
  expect(screen.queryByText('Not glazed yet')).toBeNull()
  await userEvent.click(screen.getByRole('button', { name: 'Edit glaze plan' }))
  expect(onPlan).toHaveBeenCalled()
})

test('used glazes that match the plan say so, and Show reveals the plan', async () => {
  const onPlan = vi.fn()
  render(
    <FactCards
      view={detail({
        glazeLayers: [{ name: 'Rutile Blue', color: '#3d6b8c' }],
        planLayers: [{ glazeId: 'g1', name: 'Rutile Blue', color: '#3d6b8c' }],
        planMatches: true,
      })}
      onPlan={onPlan}
    />,
  )
  expect(screen.getByText('Same as plan')).toBeVisible()
  expect(screen.queryByRole('list', { name: 'Glaze plan' })).toBeNull()
  await userEvent.click(screen.getByRole('button', { name: 'Show' }))
  expect(screen.getByRole('list', { name: 'Glaze plan' })).toBeVisible()
  expect(screen.getByRole('button', { name: 'Hide' })).toHaveAttribute(
    'aria-expanded',
    'true',
  )
  await userEvent.click(screen.getByRole('button', { name: 'Edit plan' }))
  expect(onPlan).toHaveBeenCalled()
})

test('used glazes that differ from the plan say they changed in the glaze lab', () => {
  render(
    <FactCards
      view={detail({
        glazeLayers: [{ name: 'Tenmoku', color: '#4a2c1c' }],
        planLayers: [{ glazeId: 'g1', name: 'Rutile Blue', color: '#3d6b8c' }],
        planMatches: false,
      })}
      onPlan={() => {}}
    />,
  )
  expect(screen.getByText('Changed in the glaze lab')).toBeVisible()
})

test('used glazes without a plan show no Plan row', () => {
  render(
    <FactCards
      view={detail({ glazeLayers: [{ name: 'Tenmoku', color: '#4a2c1c' }] })}
      onPlan={() => {}}
    />,
  )
  expect(screen.queryByText('Plan')).toBeNull()
})
