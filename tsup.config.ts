import { defineConfig } from 'tsup'
import packageJson from './package.json' with { type: 'json' }

const shared = {
  format: ['esm', 'cjs'] as const,
  dts: true,
  splitting: false,
  sourcemap: true,
  clean: false,
  platform: 'node' as const,
  target: 'node20.19' as const,
  minify: true,
  define: {
    __PACKAGE_VERSION__: JSON.stringify(packageJson.version),
  },
}

export default defineConfig([
  {
    ...shared,
    entry: {
      index: 'src/index.ts',
    },
    // No shebang banner here: the library entry must stay a plain importable
    // module. clean:true only on the first config so the second build does
    // not wipe the first entry's output.
    clean: true,
  },
  {
    ...shared,
    entry: {
      cli: 'src/cli.ts',
    },
    // Shebang scoped to the CLI entry only. A single-config `banner` would
    // prepend `#!/usr/bin/env node` to the library output (dist/index.js)
    // as well, where it is at best noise.
    banner: {
      js: '#!/usr/bin/env node',
    },
    // Function form (not `chmod +x ...` shell string) so `npm run build`
    // also exits 0 on Windows, where `chmod` does not exist.
    onSuccess: async () => {
      const { chmod } = await import('node:fs/promises')
      await chmod('dist/cli.js', 0o755)
    },
  },
])
