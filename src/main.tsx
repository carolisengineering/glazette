import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/inter/400.css'
import '@fontsource/inter/500.css'
import '@fontsource/inter/600.css'
import '@fontsource/instrument-serif/400.css'
import App from './App'
import { startAccountRefresh } from './account/useAccount'
import { ensureDefaults } from './db/ops'
import { processImage } from './photos/process'
import { requestPersistence } from './pwa/persist'
import { ReloadPrompt } from './pwa/ReloadPrompt'
import { startSync } from './sync/useSync'
import './styles/app.css'

// Seeds the default clay and settings once per app start.
ensureDefaults()
  .then(() => requestPersistence())
  .catch((err) => console.error('Could not set up defaults', err))

// Doesn't wait on the setup above; persist() can sit on a permission prompt.
startAccountRefresh()
startSync()

// End-to-end tests (built with --mode e2e) call the photo pipeline directly.
if (import.meta.env.MODE !== 'production') {
  window.__glazette = { processImage }
}

const root = document.getElementById('root')
if (!root) throw new Error('Missing #root element')

createRoot(root).render(
  <StrictMode>
    <App />
    <ReloadPrompt />
  </StrictMode>,
)
