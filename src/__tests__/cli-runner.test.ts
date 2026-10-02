import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { runCli } from '../cli-runner.js'
import { createTempProject, type TempProject } from './helpers/temp-project.js'

let project: TempProject | undefined

afterEach(() => project?.cleanup())

function io() {
  let stdout = ''
  let stderr = ''
  return {
    io: {
      cwd: () => project!.root,
      stdout: (value: string) => {
        stdout += value
      },
      stderr: (value: string) => {
        stderr += value
      },
    },
    output: () => ({ stdout, stderr }),
  }
}

describe('CLI runner', () => {
  it('shows command-specific help', async () => {
    const context = io()
    expect(await runCli(['scan', '--help'], context.io)).toBe(0)
    expect(context.output().stdout).toContain('i18n-hunter scan')
  })

  it('rejects invalid formats without creating a report', async () => {
    project = createTempProject()
    project.write('src/App.tsx', 'export const App = () => <div>Hello</div>')
    const context = io()

    expect(await runCli(['scan', '--format', 'xml'], context.io)).toBe(1)
    expect(context.output().stderr).toContain('format')
    expect(existsSync(join(project.root, 'i18n-reports'))).toBe(false)
  })

  it('writes reports for clean and incomplete scans with documented exit codes', async () => {
    project = createTempProject()
    project.write('src/App.tsx', 'export const App = () => <div>Hello</div>')
    project.write('src/Broken.tsx', 'export const Broken = () => <div>Broken')
    const context = io()

    expect(await runCli(['scan', '--filename', 'report', '--format', 'json,md'], context.io)).toBe(
      2,
    )
    expect(existsSync(join(project.root, 'i18n-reports/report.json'))).toBe(true)
    expect(readFileSync(join(project.root, 'i18n-reports/report.json'), 'utf8')).not.toContain(
      '"hardcodedString"',
    )
    expect(context.output().stderr).toContain('E_PARSE_FAILED')
  })

  it('runs apply, sync, rollback, and clean without exiting successfully on operation errors', async () => {
    project = createTempProject()
    const original = 'export const App = () => <div>Hello</div>'
    project.write('src/App.tsx', original)
    const context = io()

    expect(await runCli(['scan', '--filename', 'report', '--format', 'json'], context.io)).toBe(0)
    const report = join(project.root, 'i18n-reports/report.json')
    expect(await runCli(['apply', '--report', report], context.io)).toBe(0)
    expect(project.read('src/App.tsx')).toContain("t('")
    expect(await runCli(['sync', '--report', report], context.io)).toBe(0)
    expect(await runCli(['rollback'], context.io)).toBe(0)
    expect(project.read('src/App.tsx')).toBe(original)
    expect(await runCli(['clean', '--yes'], context.io)).toBe(0)
  })

  it('does not write to console from the CLI runner', async () => {
    project = createTempProject()
    const stdout = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const stderr = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    await runCli(['--help'], io().io)

    expect(stdout).not.toHaveBeenCalled()
    expect(stderr).not.toHaveBeenCalled()
    stdout.mockRestore()
    stderr.mockRestore()
  })
})
