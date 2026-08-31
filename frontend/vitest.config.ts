import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

// pdfkit's export map is { node: pdfkit.node.mjs, default: pdfkit.browser.mjs },
// and only the browser build exports registerStdFonts. Conditions in an export
// map are matched in the map's OWN key order, so while Vitest keeps `node` in the
// active set -- it does, for the SSR-ish environment tests run in -- `node` wins
// no matter where 'browser' sits in resolve.conditions. The condition list cannot
// fix this; only bypassing the map can. Hence an exact-match alias.
//
// It must be exact (/^pdfkit$/): @react-pdf/font also imports
// 'pdfkit/standard-fonts/*', and a bare string alias rewrites those subpaths too
// and breaks the import.
const pdfkitBrowserBuild = fileURLToPath(
  new URL('./node_modules/pdfkit/js/pdfkit.browser.mjs', import.meta.url),
)

export default defineConfig({
  plugins: [react()],
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    css: true,
    projects: [
      {
        // Everything except the PDF render test.
        extends: true,
        test: {
          name: 'unit',
          exclude: ['**/node_modules/**', '**/PdfExport/BunkPlanReport.test.tsx'],
        },
      },
      {
        // @react-pdf/renderer ships two builds. Vite picks the BROWSER one for
        // the app bundle; plain Node resolution picks the node one, which no
        // user ever runs. Resolving this file the way the app is bundled means
        // the PDF assertions cover the code that actually ships -- and avoids
        // the node build's Buffer/Uint8Array realm bug under jsdom (the old
        // @react-pdf/pdfkit fork corrupted every FlateDecode stream when
        // globalThis.Uint8Array came from jsdom's realm). @react-pdf/renderer
        // 4.9.0 dropped that fork for upstream pdfkit, which does not have the
        // bug -- verified by round-tripping text back out through pdf-parse in
        // BunkPlanReport.test.tsx, which is what those assertions are for.
        extends: true,
        resolve: {
          conditions: ['browser', 'import', 'module', 'default'],
          mainFields: ['browser', 'module', 'main'],
          alias: [{ find: /^pdfkit$/, replacement: pdfkitBrowserBuild }],
        },
        test: {
          name: 'pdf',
          include: ['**/PdfExport/BunkPlanReport.test.tsx'],
          // Force Vite (not Node) to resolve these, so the conditions above apply.
          server: { deps: { inline: [/@react-pdf/, /^pdfkit$/] } },
        },
      },
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: ['node_modules/', 'src/test/', '**/*.d.ts', '**/*.config.*', '**/mockData/*'],
      thresholds: {
        lines: 20,
        functions: 20,
        branches: 14,
        statements: 20,
      },
    },
  },
})
