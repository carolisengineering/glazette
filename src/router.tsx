import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  type RouterHistory,
} from '@tanstack/react-router'
import { CaptureScreen } from './routes/capture'
import { GlazesScreen } from './routes/glazes'
import { PieceScreen } from './routes/piece'
import { ShelfScreen } from './routes/shelf'

const rootRoute = createRootRoute({ component: Outlet })

const shelfRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: ShelfScreen,
})
const pieceRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/piece/$id',
  component: PieceScreen,
})
const glazesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/glazes',
  component: GlazesScreen,
})
const captureRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/capture',
  validateSearch: (
    search: Record<string, unknown>,
  ): { pieceId?: string; addPhoto?: true } => ({
    ...(typeof search.pieceId === 'string' && search.pieceId
      ? { pieceId: search.pieceId }
      : {}),
    ...(search.addPhoto === true ? { addPhoto: true as const } : {}),
  }),
  component: CaptureScreen,
})

const routeTree = rootRoute.addChildren([
  shelfRoute,
  pieceRoute,
  glazesRoute,
  captureRoute,
])

/** Pass a memory history in tests; the app uses the browser history. */
export function createAppRouter(history?: RouterHistory) {
  return createRouter({ routeTree, history })
}

export const router = createAppRouter()

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof createAppRouter>
  }
}
