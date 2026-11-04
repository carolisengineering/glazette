import { createMemoryHistory, RouterProvider } from '@tanstack/react-router'
import { render } from '@testing-library/react'
import { createAppRouter } from '../router'

/** Renders the app at a URL with an in-memory history. Returns the router for navigation assertions. */
export function renderRoute(url: string) {
  const router = createAppRouter(createMemoryHistory({ initialEntries: [url] }))
  render(<RouterProvider router={router} />)
  return router
}
