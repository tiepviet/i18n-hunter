import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const temp = mkdtempSync(join(tmpdir(), 'i18n-hunter-package-smoke-'))
const packDir = join(temp, 'pack')
const consumer = join(temp, 'consumer')
mkdirSync(packDir, { recursive: true })
mkdirSync(consumer, { recursive: true })

function command(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', timeout: 120_000 })
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed\n${result.stdout}\n${result.stderr}`)
  }
  return result
}

function write(base, relativePath, content) {
  const path = join(base, relativePath)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content, 'utf8')
  return path
}

try {
  const packed = JSON.parse(
    command('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', packDir], root)
      .stdout,
  )
  const artifact = packed[0]
  if (!artifact || artifact.entryCount < 5)
    throw new Error('Packed artifact is missing expected files')
  if (artifact.unpackedSize > 5_000_000)
    throw new Error(`Packed artifact exceeds size budget: ${artifact.unpackedSize}`)
  if (artifact.files.some((file) => /(^|\/)(src|coverage|node_modules)\//.test(file.path))) {
    throw new Error('Packed artifact contains development-only files')
  }

  write(
    consumer,
    'package.json',
    JSON.stringify({ name: 'i18n-hunter-smoke-consumer', private: true, type: 'module' }),
  )
  const tarball = join(packDir, artifact.filename)
  command('npm', ['install', '--ignore-scripts', tarball], consumer)

  const packageRoot = join(consumer, 'node_modules/i18n-hunter')
  if (existsSync(join(consumer, 'node_modules/@vue/compiler-sfc'))) {
    throw new Error('React-only install unexpectedly installed optional Vue peers')
  }
  command(
    process.execPath,
    ['--input-type=module', '--eval', "import('i18n-hunter').then(() => console.log('esm ok'))"],
    consumer,
  )
  command(
    process.execPath,
    ['--input-type=commonjs', '--eval', "require('i18n-hunter'); console.log('cjs ok')"],
    consumer,
  )
  command('npm', ['install', '--ignore-scripts', 'typescript@5.9.3'], consumer)
  write(
    consumer,
    'index.cts',
    "import hunter = require('i18n-hunter')\nconst value: typeof hunter = hunter\nvoid value\n",
  )
  command(
    join(consumer, 'node_modules/.bin/tsc'),
    ['--noEmit', '--strict', '--module', 'Node16', '--moduleResolution', 'Node16', 'index.cts'],
    consumer,
  )

  write(consumer, 'src/App.tsx', 'export const App = () => <div>React package smoke</div>')
  const reactCli = join(packageRoot, 'dist/cli.js')
  command(
    process.execPath,
    [reactCli, 'scan', '--filename', 'react-report', '--format', 'json'],
    consumer,
  )
  command(
    process.execPath,
    [reactCli, 'apply', '--report', join(consumer, 'i18n-reports/react-report.json')],
    consumer,
  )

  command(
    'npm',
    ['install', '--ignore-scripts', '@vue/compiler-sfc@3.5.43', '@vue/compiler-dom@3.5.43'],
    consumer,
  )
  write(consumer, 'src/Card.vue', '<template><button>Vue package smoke</button></template>')
  command(
    process.execPath,
    [reactCli, 'scan', '--path', 'src/Card.vue', '--filename', 'vue-report', '--format', 'json'],
    consumer,
  )
  command(
    process.execPath,
    [reactCli, 'apply', '--report', join(consumer, 'i18n-reports/vue-report.json')],
    consumer,
  )
  if (!readFileSync(join(consumer, 'src/Card.vue'), 'utf8').includes('$t(')) {
    throw new Error('Installed Vue CLI did not transform the Vue fixture')
  }

  process.stdout.write('Package smoke test passed\n')
} finally {
  rmSync(temp, { recursive: true, force: true })
}
