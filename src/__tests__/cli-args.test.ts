import { describe, expect, it } from 'vitest'
import { parseCliArgs } from '../cli-args.js'

describe('CLI argument parsing', () => {
  it('parses global help and version', () => {
    expect(parseCliArgs(['--help'])).toEqual({ kind: 'global-help' })
    expect(parseCliArgs(['--version'])).toEqual({ kind: 'version' })
  })

  it('parses command-specific help instead of global help', () => {
    expect(parseCliArgs(['scan', '--help'])).toEqual({ kind: 'command-help', command: 'scan' })
  })

  it('parses repeatable and comma-separated scan paths', () => {
    expect(
      parseCliArgs(['scan', '--path', 'src/a.ts', '--paths', 'src/b.ts,src/c.ts']),
    ).toMatchObject({
      kind: 'scan',
      scanPaths: ['src/a.ts', 'src/b.ts', 'src/c.ts'],
    })
  })

  it('rejects unknown commands, flags, missing values, and duplicate singleton options', () => {
    expect(() => parseCliArgs(['unknown'])).toThrow(/unknown command/i)
    expect(() => parseCliArgs(['scan', '--wat', 'x'])).toThrow(/unknown option/i)
    expect(() => parseCliArgs(['scan', '--output'])).toThrow(/requires a value/i)
    expect(() => parseCliArgs(['scan', '--output', 'a', '--output', 'b'])).toThrow(/duplicate/i)
  })

  it('requires reports for apply and sync', () => {
    expect(() => parseCliArgs(['apply'])).toThrow(/--report/i)
    expect(() => parseCliArgs(['sync'])).toThrow(/--report/i)
  })

  it('requires explicit confirmation for clean and does not expose force cleanup', () => {
    expect(() => parseCliArgs(['clean'])).toThrow(/--yes/i)
    expect(() => parseCliArgs(['clean', '--all', '--yes'])).toThrow(/unknown option/i)
    expect(parseCliArgs(['clean', '--yes'])).toMatchObject({ kind: 'clean', yes: true })
  })

  it('rejects unsupported formats and invalid limits', () => {
    expect(() => parseCliArgs(['scan', '--format', 'xml'])).toThrow(/format/i)
    expect(() => parseCliArgs(['scan', '--max-files', '0'])).toThrow(/max-files/i)
  })
})
