import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/inter/400.css'
import '@fontsource/inter/500.css'
import '@fontsource/inter/600.css'
import '@fontsource/instrument-serif/400.css'
import App from './App'
import { ensureDefaults } from './db/ops'
import { requestPersistence } from './pwa/persist'
import { ReloadPrompt } from './pwa/ReloadPrompt'
import './styles/app.css'

// Seeds the default clay and settings once per app start.
ensureDefaults()
  .then(() => requestPersistence())
  .catch((err) => console.error('Could not set up defaults', err))

const root = document.getElementById('root')
if (!root) throw new Error('Missing #root element')

createRoot(root).render(
  <StrictMode>
    <App />
    <ReloadPrompt />
  </StrictMode>,
)
