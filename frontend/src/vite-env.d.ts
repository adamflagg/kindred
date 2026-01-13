/// <reference types="vite/client" />

interface ImportMetaEnv {
  // No VITE-specific environment variables are used anymore
  // All API routing is handled by nginx/Vite proxy configuration
  readonly DEV: boolean
  // Version information injected at build time
  readonly VITE_APP_VERSION: string
  readonly VITE_APP_BUILD_DATE: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}