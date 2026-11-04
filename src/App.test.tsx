import { render, screen } from '@testing-library/react'
import App from './App'

test('renders the Shelf title', async () => {
  render(<App />)
  expect(
    await screen.findByRole('heading', { name: 'My Shelf' }),
  ).toBeInTheDocument()
})
