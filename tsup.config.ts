import { defineConfig } from 'tsup'

export default defineConfig([
  // Library build — external all Node built-ins, bundle babel for self-contained usage
  {
    entry: { index: 'src/index.ts' },
    format: ['esm', 'cjs'],
    dts: true,
    splitting: false,
    sourcemap: true,
    clean: true,
    platform: 'node',
    target: 'node18',
    minify: true,
    // Bundle babel so consumers don't need to install it
    noExternal: ['@babel/parser', '@babel/types'],
  },
  // CLI build — self-contained binary with babel bundled in
  {
    entry: { cli: 'src/cli.ts' },
    format: ['esm'],
    dts: false,
    splitting: false,
    sourcemap: true,
    platform: 'node',
    target: 'node18',
    minify: true,
    // Bundle babel so the CLI works after `npm install -g i18n-hunter`
    noExternal: ['@babel/parser', '@babel/types'],
    banner: {
      js: '#!/usr/bin/env node',
    },
    onSuccess: 'chmod +x dist/cli.js',
  },
])
