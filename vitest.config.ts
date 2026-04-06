import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    // Strip .js from relative imports so Vite can resolve .ts source files
    alias: [{ find: /^(\.+\/.+)\.js$/, replacement: '$1' }],
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['src/__tests__/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: ['**/node_modules/**', '**/dist/**', 'src/cli.ts'],
    },
  },
})
