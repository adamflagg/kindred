#!/usr/bin/env node

import { execSync } from 'child_process';

console.log('Generating PocketBase types...');

try {
  // Generate types from the PocketBase instance
  execSync('npx pocketbase-typegen --db ../pocketbase/pb_data/data.db --out ./src/types/pocketbase-types.ts', {
    stdio: 'inherit'
  });
  
  console.log('✅ Types generated successfully!');
} catch (error) {
  console.error('❌ Failed to generate types:', error);
  process.exit(1);
}