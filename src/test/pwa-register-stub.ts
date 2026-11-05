// Stands in for the virtual module vite-plugin-pwa provides at build time.
// Tests that care about it vi.mock() it; everything else gets this inert version.
export function useRegisterSW() {
  return {
    needRefresh: [false, () => {}] as const,
    offlineReady: [false, () => {}] as const,
    updateServiceWorker: async () => {},
  }
}
