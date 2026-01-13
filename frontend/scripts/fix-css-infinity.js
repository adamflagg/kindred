#!/usr/bin/env node

import { readFileSync, writeFileSync, readdirSync } from 'fs';
import { join } from 'path';

const distDir = join(process.cwd(), 'dist', 'assets');

// Find all CSS files in dist/assets
const cssFiles = readdirSync(distDir).filter(file => file.endsWith('.css'));

console.log(`Found ${cssFiles.length} CSS files to check...`);

cssFiles.forEach(file => {
  const filePath = join(distDir, file);
  let content = readFileSync(filePath, 'utf8');
  
  // Count occurrences before fix
  const matches = content.match(/border-radius:3\.40282e38px/g);
  const count = matches ? matches.length : 0;
  
  if (count > 0) {
    console.log(`Fixing ${count} infinity border-radius values in ${file}...`);
    
    // Replace infinity value with 9999px (common fallback for fully rounded elements)
    content = content.replace(/border-radius:3\.40282e38px/g, 'border-radius:9999px');
    
    // Write the fixed content back
    writeFileSync(filePath, content, 'utf8');
    console.log(`✓ Fixed ${file}`);
  }
});

console.log('CSS fix complete!');