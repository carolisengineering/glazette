import { render, screen } from '@testing-library/react'
import App from './App'

test('renders the Shelf title', () => {
  render(<App />)
  expect(screen.getByRole('heading', { name: 'My Shelf' })).toBeInTheDocument()
})
