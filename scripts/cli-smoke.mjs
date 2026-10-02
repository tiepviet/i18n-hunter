import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const cli = join(root, 'dist/cli.js')
const project = mkdtempSync(join(tmpdir(), 'i18n-hunter-cli-smoke-'))

function write(relativePath, content) {
  const path = join(project, relativePath)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content, 'utf8')
}

function run(args, expected = 0) {
  const result = spawnSync(process.execPath, [cli, ...args], {
    cwd: project,
    encoding: 'utf8',
    timeout: 15_000,
  })
  if (result.status !== expected) {
    throw new Error(
      `CLI ${args.join(' ')} exited ${result.status}, expected ${expected}\n${result.stdout}\n${result.stderr}`,
    )
  }
  return result
}

try {
  const original = 'export const App = () => <div>CLI smoke message</div>'
  write('src/App.tsx', original)

  const help = run(['scan', '--help'])
  if (!help.stdout.includes('i18n-hunter scan'))
    throw new Error('Command-specific help was not printed')
  run(['--version'])
  run(['scan', '--format', 'xml'], 1)
  run(['scan', '--filename', 'report', '--format', 'json'])
  const report = join(project, 'i18n-reports/report.json')
  run(['apply', '--report', report])
  if (!readFileSync(join(project, 'src/App.tsx'), 'utf8').includes("t('"))
    throw new Error('Apply did not transform source')
  run(['sync', '--report', report])
  run(['rollback'])
  if (readFileSync(join(project, 'src/App.tsx'), 'utf8') !== original)
    throw new Error('Rollback did not restore source')
  run(['clean', '--yes'])

  process.stdout.write('CLI smoke test passed\n')
} finally {
  rmSync(project, { recursive: true, force: true })
}
