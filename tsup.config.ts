import { defineConfig } from 'tsup'
import packageJson from './package.json' with { type: 'json' }

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    cli: 'src/cli.ts',
  },
  format: ['esm', 'cjs'],
  dts: true,
  splitting: false,
  sourcemap: true,
  clean: true,
  platform: 'node',
  target: 'node20.19',
  minify: true,
  define: {
    __PACKAGE_VERSION__: JSON.stringify(packageJson.version),
  },
  banner: {
    js: '#!/usr/bin/env node',
  },
  onSuccess: 'chmod +x dist/cli.js',
})
