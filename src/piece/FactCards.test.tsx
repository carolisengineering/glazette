import { render, screen } from '@testing-library/react'
import type { PieceDetail } from '../db/queries'
import { FactCards } from './FactCards'

function detail(over: Partial<PieceDetail> = {}): PieceDetail {
  return {
    piece: { id: 'p', createdAt: '2026-11-01', updatedAt: '2026-11-01' },
    entries: [],
    clayName: 'White stoneware',
    glazeNames: [],
    glazeColors: [],
    cone: '6',
    ...over,
  }
}

test('the glaze box comes before clay and firing', () => {
  render(<FactCards view={detail()} />)
  const labels = ['Glaze', 'Clay', 'Firing'].map((l) => screen.getByText(l))
  const [glaze, clay, firing] = labels
  expect(glaze.compareDocumentPosition(clay)).toBe(
    Node.DOCUMENT_POSITION_FOLLOWING,
  )
  expect(clay.compareDocumentPosition(firing)).toBe(
    Node.DOCUMENT_POSITION_FOLLOWING,
  )
})

test('each glaze gets its own line and a dot in its own color, in layer order', () => {
  render(
    <FactCards
      view={detail({
        glazeNames: ['Celadon', 'Floating Blue', 'Tenmoku'],
        glazeColors: ['#8FB3A3', '#3F6F9A', '#4A2F22'],
      })}
    />,
  )
  const lines = screen.getAllByTestId('glaze-line')
  expect(lines.map((l) => l.textContent)).toEqual([
    'Celadon',
    'Floating Blue',
    'Tenmoku',
  ])
  expect(
    screen.getAllByTestId('glaze-dot').map((d) => d.style.backgroundColor),
  ).toEqual(['rgb(143, 179, 163)', 'rgb(63, 111, 154)', 'rgb(74, 47, 34)'])
})

test('an unglazed piece says so, with no dot', () => {
  render(<FactCards view={detail()} />)
  expect(screen.getByText('Not glazed yet')).toBeVisible()
  expect(screen.queryByTestId('glaze-dot')).toBeNull()
})

test('long clay and glaze names are not cut off', () => {
  render(
    <FactCards
      view={detail({
        clayName: 'Speckled buff stoneware',
        glazeNames: ['Floating Blue over Shino'],
        glazeColors: ['#3F6F9A'],
      })}
    />,
  )
  for (const text of ['Speckled buff stoneware', 'Floating Blue over Shino']) {
    expect(screen.getByText(text)).not.toHaveClass('truncate')
  }
})
