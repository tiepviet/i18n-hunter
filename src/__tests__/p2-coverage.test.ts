import { afterEach, describe, expect, it } from 'vitest'
import { runCli, type CliIo } from '../cli-runner.js'
import { HunterError } from '../errors.js'
import { parseReactSource } from '../react-parser.js'
import { scanForHardcodedStrings } from '../scanner.js'
import { createFileTransformPlan } from '../transform.js'
import { createTempProject, type TempProject } from './helpers/temp-project.js'

let project: TempProject | undefined

afterEach(() => {
  project?.cleanup()
  project = undefined
})

function io(): { io: CliIo; output: () => { stdout: string; stderr: string } } {
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

describe('P2 regression coverage', () => {
  it('documents the export default memo() component-scope gap without asserting fixed behavior', async () => {
    const source = `import { memo } from 'react'\nexport default memo(() => <div>Hi</div>)\n`
    const parsed = parseReactSource(source, 'src/App.tsx')

    expect(parsed.diagnostics.filter((item) => item.severity === 'error')).toEqual([])
    const jsx = parsed.candidates.filter((item) => item.transform.startsWith('react-'))

    project = createTempProject()
    project.write('src/App.tsx', source)
    const report = await scanForHardcodedStrings({ scanPaths: ['src'] }, project.root)
    const findings = report.findings.filter((item) => item.filePath === 'src/App.tsx')

    if (jsx.length === 0 || findings.length === 0) {
      // Current gap variant A: memo-wrapped output is skipped entirely.
      expect(findings).toHaveLength(0)
      return
    }
    if (jsx.every((item) => item.component === undefined)) {
      // Current gap variant B: extracted but unscoped — downstream must refuse
      // fail-closed instead of rewriting outside a component scope.
      try {
        await createFileTransformPlan(source, 'src/App.tsx', findings)
        expect.unreachable('unscoped memo() findings must not transform silently')
      } catch (error) {
        expect(error).toBeInstanceOf(HunterError)
        expect((error as HunterError).code).toBe('E_UNSUPPORTED_TRANSFORM')
      }
      return
    }
    // Fixed behavior: memo() is component-scoped — the plan applies cleanly.
    const plan = await createFileTransformPlan(source, 'src/App.tsx', findings)
    expect(plan.changed).toBe(true)
  })

  it('keeps license-header import injection fail-closed', async () => {
    const source = `// license\nconst App = () => <div>Hi</div>\n`
    project = createTempProject()
    project.write('src/App.tsx', source)
    const report = await scanForHardcodedStrings({ scanPaths: ['src'] }, project.root)
    const findings = report.findings.filter((item) => item.filePath === 'src/App.tsx')

    expect(findings.length).toBeGreaterThan(0)
    try {
      const plan = await createFileTransformPlan(source, 'src/App.tsx', findings)
      // Either untouched, or the injected import lands on its own line after
      // the license comment (leading newline intact, never glued to `//`).
      expect(plan.changed === false || plan.content.includes('\nimport')).toBe(true)
      if (plan.changed) {
        expect(plan.content.startsWith('// license')).toBe(true)
      }
    } catch (error) {
      // Fail-closed is also acceptable: refusing to emit unparseable output.
      expect(error).toBeInstanceOf(HunterError)
      expect((error as HunterError).code).toBe('E_PARSE_FAILED')
    }
  })

  it('stays green with --fail-on never when no error diagnostics exist', async () => {
    project = createTempProject()
    project.write('src/App.tsx', 'export const App = () => <div>Hello</div>')
    const context = io()

    const exit = await runCli(
      ['scan', '--fail-on', 'never', '--filename', 'p2-never-clean'],
      context.io,
    )

    expect(exit).toBe(0)
    expect(context.output().stderr).not.toMatch(/E_PARSE_FAILED|E_UNSUPPORTED_TRANSFORM/)
  })

  it('ignores error diagnostics with --fail-on never', async () => {
    project = createTempProject()
    project.write('src/App.tsx', 'export const App = () => <div>Hello</div>')
    project.write('src/Broken.tsx', 'export const Broken = () => <div>Broken')
    const context = io()

    const exit = await runCli(
      ['scan', '--fail-on', 'never', '--filename', 'p2-never-broken'],
      context.io,
    )

    expect(exit).toBe(0)
    expect(context.output().stderr).toContain('E_PARSE_FAILED')
  })

  it('fails on error diagnostics with --fail-on error|warning', async () => {
    project = createTempProject()
    project.write('src/App.tsx', 'export const App = () => <div>Hello</div>')
    project.write('src/Broken.tsx', 'export const Broken = () => <div>Broken')

    const errorContext = io()
    await expect(
      runCli(['scan', '--fail-on', 'error', '--filename', 'p2-fail-error'], errorContext.io),
    ).resolves.toBe(2)
    expect(errorContext.output().stderr).toContain('E_PARSE_FAILED')

    const warningContext = io()
    await expect(
      runCli(['scan', '--fail-on', 'warning', '--filename', 'p2-fail-warning'], warningContext.io),
    ).resolves.toBe(2)
    expect(warningContext.output().stderr).toContain('E_PARSE_FAILED')
  })
})
