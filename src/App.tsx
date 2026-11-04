import { RouterProvider } from '@tanstack/react-router'
import { router } from './router'

export default function App() {
  return (
    <div className="min-h-screen bg-background font-sans text-ink">
      <RouterProvider router={router} />
    </div>
  )
}
