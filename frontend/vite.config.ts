import type { UserConfig, Plugin } from 'vite';
import { defineConfig, mergeConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { existsSync, readFileSync, createReadStream, statSync } from 'fs'
import { resolve } from 'path'

// =============================================================================
// Branding Configuration
// =============================================================================
// Load default branding from config/branding.json, with optional local overrides
// Skip local overrides with USE_DEFAULT_BRANDING=true to test fallback UI

interface BrandingConfig {
  camp_name: string;
  camp_name_short: string;
  camp_description: string;
  camp_tagline: string;
  sso_display_name: string;
  page_title: string;
  page_description: string;
  logo: {
    large: string | null;
    nav: string | null;
  };
}

// Load default branding
const defaultBrandingPath = resolve(__dirname, '../config/branding.json')
let defaultBranding: BrandingConfig = {
  camp_name: 'Kindred',
  camp_name_short: 'Kindred',
  camp_description: 'a cabin assignment system that puts relationships first',
  camp_tagline: 'where campers find their people',
  sso_display_name: 'Staff SSO',
  page_title: 'Kindred',
  page_description: 'Cabin assignments that put relationships first',
  logo: { large: null, nav: null },
}

if (existsSync(defaultBrandingPath)) {
  try {
    defaultBranding = JSON.parse(readFileSync(defaultBrandingPath, 'utf-8'))
  } catch (e) {
    console.warn('⚠ Failed to load branding.json, using hardcoded defaults:', e)
  }
}

// Load local branding overrides
let localBranding: Partial<BrandingConfig> = {}
const useDefaultBranding = process.env.USE_DEFAULT_BRANDING === 'true'
const brandingPath = resolve(__dirname, '../config/branding.local.json')

if (useDefaultBranding) {
  console.log('ℹ️  USE_DEFAULT_BRANDING=true - using default branding (no local overrides)')
} else if (existsSync(brandingPath)) {
  try {
    const content = readFileSync(brandingPath, 'utf-8')
    // Check if file is git-crypt encrypted (starts with binary data)
    if (!content.startsWith('\x00GITCRYPT')) {
      localBranding = JSON.parse(content)
      console.log('✓ Loaded local branding from config/branding.local.json')
    } else {
      console.log('⚠ config/branding.local.json is git-crypt encrypted, using defaults')
    }
  } catch (e) {
    console.warn('⚠ Failed to load branding.local.json:', e)
  }
}

// Merge branding with local overrides
const branding: BrandingConfig = {
  ...defaultBranding,
  ...localBranding,
  logo: {
    ...defaultBranding.logo,
    ...(localBranding.logo || {}),
  },
}

// =============================================================================
// Plugin: Serve Local Assets
// =============================================================================
// Serves /local/* from project root's local/ directory (for logo images, etc.)

function serveLocalAssets(): Plugin {
  return {
    name: 'serve-local-assets',
    configureServer(server) {
      const localDir = resolve(__dirname, '../local')

      // Serve files directly to avoid CORS middleware issues with re-routed requests
      server.middlewares.use('/local', (req, res, next) => {
        if (!req.url) return next()

        // Remove query string and decode URL
        const urlPath = decodeURIComponent(req.url.split('?')[0])
        const filePath = resolve(localDir, urlPath.slice(1)) // Remove leading /

        // Security: ensure path is within localDir (prevent directory traversal)
        if (!filePath.startsWith(localDir)) {
          return next()
        }

        if (existsSync(filePath)) {
          try {
            const stat = statSync(filePath)
            if (!stat.isFile()) return next()

            // Set appropriate content type
            const ext = filePath.split('.').pop()?.toLowerCase()
            const mimeTypes: Record<string, string> = {
              'png': 'image/png',
              'jpg': 'image/jpeg',
              'jpeg': 'image/jpeg',
              'svg': 'image/svg+xml',
              'gif': 'image/gif',
              'ico': 'image/x-icon',
              'webp': 'image/webp',
            }

            res.setHeader('Content-Type', mimeTypes[ext || ''] || 'application/octet-stream')
            res.setHeader('Content-Length', stat.size)
            res.setHeader('Cache-Control', 'public, max-age=3600')

            createReadStream(filePath).pipe(res)
          } catch {
            next()
          }
          return
        }
        next()
      })
    },
  }
}

// =============================================================================
// Plugin: Transform Index HTML
// =============================================================================
// Replaces branding placeholders in index.html with actual values

function transformBrandingHtml(): Plugin {
  return {
    name: 'transform-branding-html',
    transformIndexHtml(html) {
      return html
        .replace(/%PAGE_TITLE%/g, branding.page_title)
        .replace(/%PAGE_DESCRIPTION%/g, branding.page_description)
        .replace(/%CAMP_NAME%/g, branding.camp_name);
    },
  }
}

// =============================================================================
// Build-time Defines
// =============================================================================

// Expose PocketBase admin credentials when VITE_DISABLE_AUTH is set (for Playwright testing)
const testAuthDefines = process.env.VITE_DISABLE_AUTH === 'true' ? {
  'import.meta.env.VITE_ADMIN_EMAIL': JSON.stringify(process.env.POCKETBASE_ADMIN_EMAIL || ''),
  'import.meta.env.VITE_ADMIN_PASSWORD': JSON.stringify(process.env.POCKETBASE_ADMIN_PASSWORD || ''),
} : {};

// Version info from build process (with fallbacks for development)
const versionDefines = {
  'import.meta.env.VITE_APP_VERSION': JSON.stringify(process.env.VITE_APP_VERSION || 'dev'),
  'import.meta.env.VITE_APP_BUILD_DATE': JSON.stringify(process.env.VITE_APP_BUILD_DATE || new Date().toISOString()),
};

// Admin UI access control
const adminDefines = {
  'import.meta.env.ADMIN_USER': JSON.stringify(process.env.ADMIN_USER || ''),
};

// =============================================================================
// Base Configuration
// =============================================================================

const baseConfig: UserConfig = {
  plugins: [
    react(),
    tailwindcss(),
    serveLocalAssets(),
    transformBrandingHtml(),
  ],
  define: {
    ...testAuthDefines,
    ...versionDefines,
    ...adminDefines,
    // Inject branding for frontend to use
    VITE_LOCAL_BRANDING: JSON.stringify(localBranding),
  },
  build: {
    rollupOptions: {
      output: {
        // Manual chunks as function for rolldown-vite compatibility
        manualChunks(id: string) {
          // Vendor chunks - split heavy libraries
          if (id.includes('node_modules')) {
            if (id.includes('react-dom') || id.includes('react-router-dom')) {
              return 'vendor-react';
            }
            if (id.includes('@tanstack/react-query')) {
              return 'vendor-query';
            }
            if (id.includes('@dnd-kit')) {
              return 'vendor-dnd';
            }
            if (id.includes('cytoscape')) {
              return 'vendor-graph';
            }
            if (id.includes('lucide-react')) {
              return 'vendor-ui';
            }
          }
          return undefined;
        },
      },
    },
    // Increase chunk size warning limit since we're intentionally chunking
    chunkSizeWarningLimit: 600,
  },
  server: {
    port: 3000,
    host: true, // Allow access from external hosts
    // Allow Vite to serve files from the local/ directory
    fs: {
      allow: ['..', '../local'],
    },
    proxy: {
      // All API requests go through Caddy (single source of truth for routing)
      // Caddy routes PocketBase patterns to PocketBase, everything else to FastAPI
      '/api': {
        target: 'http://127.0.0.1:8080',  // Caddy handles all routing
        changeOrigin: true,
        ws: true,
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq, req) => {
            // Ensure proper headers for OAuth2
            if (req.headers.host) {
              proxyReq.setHeader('X-Forwarded-Host', req.headers.host);
            }
          });
        },
      },
      // PocketBase admin UI (direct to PocketBase)
      '/_': {
        target: 'http://127.0.0.1:8090',
        changeOrigin: true,
      },
    },
  },
  clearScreen: false // Also disable for build mode
}

// =============================================================================
// Local Configuration Override (git-crypt encrypted)
// =============================================================================
// Contains private FQDNs, HMR settings, CORS origins
// Falls back gracefully if not available (CI without git-crypt key)

const localConfigPath = resolve(__dirname, 'vite.config.local.ts')
let localConfig: UserConfig = {}

if (existsSync(localConfigPath)) {
  try {
    // Dynamic import is async, but Vite supports top-level await in config
    const { localConfig: imported } = await import('./vite.config.local')
    localConfig = imported
    console.log('✓ Loaded local Vite configuration from vite.config.local.ts')
  } catch {
    // Expected in CI when file is git-crypt encrypted
    console.log('ℹ️  vite.config.local.ts not loaded (encrypted or invalid) - using defaults')
  }
}

// https://vitejs.dev/config/
export default defineConfig(mergeConfig(baseConfig, localConfig))
