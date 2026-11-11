import { render, screen, within } from '@testing-library/react'
import type { PieceDetail } from '../db/queries'
import { FactCards } from './FactCards'

function detail(over: Partial<PieceDetail> = {}): PieceDetail {
  return {
    piece: { id: 'p', createdAt: '2026-11-01', updatedAt: '2026-11-01' },
    entries: [],
    clayName: 'White stoneware',
    glazeNames: [],
    glazeLayers: [],
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
  render(<FactCards view={detail()} />)
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

test('two layers of the same glaze both show', () => {
  render(
    <FactCards
      view={detail(layers(['Celadon', '#8FB3A3'], ['Celadon', '#8FB3A3']))}
    />,
  )
  expect(screen.getAllByRole('listitem')).toHaveLength(2)
})

test('an unglazed piece says so, with no list and no dot', () => {
  render(<FactCards view={detail()} />)
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
