import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import './index.css'
import { isChunkLoadError } from './utils/chunkLoadError'

/**
 * Global handler for dynamic import failures that bypass React error boundaries.
 *
 * When a new version is deployed:
 * 1. Old chunk files (with content hashes) are removed
 * 2. Inactive browser tabs still reference old chunk URLs
 * 3. Dynamic imports fail when trying to load non-existent chunks
 * 4. Server returns HTML (SPA fallback) instead of JS
 * 5. Browser gets MIME type error or fetch failure
 *
 * This handler detects these failures and prompts the user to reload.
 */
function handleChunkLoadError(event: PromiseRejectionEvent | ErrorEvent) {
  const error = 'reason' in event ? event.reason : event.error;

  if (isChunkLoadError(error)) {
    event.preventDefault();

    // Show a confirmation dialog to avoid surprising the user
    const shouldReload = window.confirm(
      'A new version of the app is available.\n\n' +
      'Would you like to reload the page to get the latest updates?'
    );

    if (shouldReload) {
      window.location.reload();
    }
  }
}

// Listen for unhandled promise rejections (from dynamic imports)
window.addEventListener('unhandledrejection', handleChunkLoadError);

// Listen for regular errors (some bundlers throw these instead)
window.addEventListener('error', handleChunkLoadError);

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Root element not found');

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)