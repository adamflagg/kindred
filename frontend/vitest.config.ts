import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

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
        // the node build's Buffer/Uint8Array realm bug under jsdom
        // (@react-pdf/pdfkit >= 6.0.1 corrupts every FlateDecode stream when
        // globalThis.Uint8Array comes from jsdom's realm).
        extends: true,
        resolve: {
          conditions: ['browser', 'import', 'module', 'default'],
          mainFields: ['browser', 'module', 'main'],
        },
        test: {
          name: 'pdf',
          include: ['**/PdfExport/BunkPlanReport.test.tsx'],
          // Force Vite (not Node) to resolve @react-pdf, so the conditions above apply.
          server: { deps: { inline: [/@react-pdf/] } },
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
