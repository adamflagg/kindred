import type { UserConfig } from 'vite'

// Local Vite configuration overrides example
// Copy this file to vite.config.local.ts and customize for your environment
// vite.config.local.ts is gitignored and won't be committed

export const localConfig: UserConfig = {
  server: {
    // Example: Restrict CORS origins for development
    cors: {
      origin: [
        'https://bunking-dev.yourdomain.com',
        'http://localhost:3000'
      ],
      credentials: true
    },
    
    // Example: Change the dev server port
    // port: 3001,
    
    // Example: Add custom headers
    // headers: {
    //   'X-Custom-Header': 'value'
    // }
  },
  
  // Example: Add custom build options
  // build: {
  //   sourcemap: true
  // }
}