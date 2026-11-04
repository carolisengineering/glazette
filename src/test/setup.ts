import '@testing-library/jest-dom/vitest'
import 'fake-indexeddb/auto'

// jsdom does not implement scrolling; the router calls it on navigation.
window.scrollTo = () => {}
