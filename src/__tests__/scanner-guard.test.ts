import { afterEach, describe, expect, it, vi } from 'vitest'
import { HunterError } from '../errors.js'
import { scanLimitCeilings, resolveScanLimits } from '../limits.js'
import { scanForHardcodedStrings } from '../scanner.js'
import { createTempProject, type TempProject } from './helpers/temp-project.js'

const mockState = vi.hoisted(() => ({
  enabled: false,
  symlinkSuffix: 'SymlinkVictim.tsx',
  outsideSuffix: 'OutsideVictim.tsx',
  genericSuffix: 'GenericVictim.tsx',
  invalidSuffix: 'InvalidVictim.tsx',
}))

vi.mock('../bounded-read.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../bounded-read.js')>()
  const { HunterError: MockHunterError } = await import('../errors.js')
  return {
    ...actual,
    readTextFileBounded: (path: string, maxBytes: number): string => {
      const normalized = path.replace(/\\/gu, '/')
      if (mockState.enabled) {
        if (normalized.endsWith(mockState.symlinkSuffix)) {
          throw new MockHunterError(
            'E_SYMLINK_REJECTED',
            'Symlink paths are not allowed in managed paths',
            path,
          )
        }
        if (normalized.endsWith(mockState.outsideSuffix)) {
          throw new MockHunterError('E_PATH_OUTSIDE_ROOT', 'Path escapes the project root', path)
        }
        if (normalized.endsWith(mockState.genericSuffix)) {
          throw new Error('boom')
        }
        if (normalized.endsWith(mockState.invalidSuffix)) {
          throw new MockHunterError('E_INVALID_INPUT', 'some other hunter error', path)
        }
      }
      return actual.readTextFileBounded(path, maxBytes)
    },
  }
})

let project: TempProject | undefined

afterEach(() => {
  mockState.enabled = false
  vi.restoreAllMocks()
  project?.cleanup()
  project = undefined
})

describe('scanner guard (N3+N5)', () => {
  it('preserves E_FILE_LIMIT for files exceeding maxFileBytes', async () => {
    project = createTempProject()
    project.write('src/Big.tsx', `export const App = () => <div>${'x'.repeat(5000)}</div>`)

    const report = await scanForHardcodedStrings(
      { scanPaths: ['src'], limits: { maxFileBytes: 1000 } },
      project.root,
    )

    const diagnostic = report.diagnostics.find((item) => item.code === 'E_FILE_LIMIT')
    expect(diagnostic).toMatchObject({
      severity: 'error',
      code: 'E_FILE_LIMIT',
      filePath: 'src/Big.tsx',
    })
    expect(diagnostic?.message).toContain('maxFileBytes')
    expect(diagnostic?.filePath).not.toContain(project.root)
    expect(report.complete).toBe(false)
  })

  it('preserves E_SYMLINK_REJECTED instead of collapsing to E_IO', async () => {
    project = createTempProject()
    project.write('src/Ok.tsx', 'export const Ok = () => <div>Fine</div>')
    project.write(`src/${mockState.symlinkSuffix}`, 'export const Victim = () => <div>Victim</div>')
    mockState.enabled = true

    const report = await scanForHardcodedStrings({ scanPaths: ['src'] }, project.root)

    const diagnostic = report.diagnostics.find((item) =>
      item.filePath?.endsWith(mockState.symlinkSuffix),
    )
    expect(diagnostic).toBeDefined()
    expect(diagnostic?.code).toBe('E_SYMLINK_REJECTED')
    expect(diagnostic?.message).toBe('Unable to read source file')
    // filePath stays portable-relative: never leak the absolute temp root.
    expect(diagnostic?.filePath).not.toContain(project.root)
    expect(diagnostic?.message).not.toContain(project.root)
    expect(report.complete).toBe(false)
  })

  it('preserves E_PATH_OUTSIDE_ROOT and defaults unknown errors to E_IO', async () => {
    project = createTempProject()
    project.write(`src/${mockState.outsideSuffix}`, 'export const A = () => <div>A</div>')
    project.write(`src/${mockState.genericSuffix}`, 'export const B = () => <div>B</div>')
    project.write(`src/${mockState.invalidSuffix}`, 'export const C = () => <div>C</div>')
    mockState.enabled = true

    const report = await scanForHardcodedStrings({ scanPaths: ['src'] }, project.root)

    const outside = report.diagnostics.find((item) =>
      item.filePath?.endsWith(mockState.outsideSuffix),
    )
    expect(outside?.code).toBe('E_PATH_OUTSIDE_ROOT')
    expect(outside?.message).toBe('Unable to read source file')
    expect(outside?.filePath).not.toContain(project.root)

    const generic = report.diagnostics.find((item) =>
      item.filePath?.endsWith(mockState.genericSuffix),
    )
    expect(generic?.code).toBe('E_IO')
    expect(generic?.message).toBe('Unable to read source file')

    // Unknown HunterError codes collapse to E_IO (fail-safe, no code smuggling).
    const invalid = report.diagnostics.find((item) =>
      item.filePath?.endsWith(mockState.invalidSuffix),
    )
    expect(invalid?.code).toBe('E_IO')
  })

  it('throws E_FILE_LIMIT when the serialized report exceeds 20MB (fail-closed)', async () => {
    project = createTempProject()
    project.write('src/App.tsx', 'export const App = () => <div>Hello guard</div>')

    const original = Buffer.byteLength.bind(Buffer)
    const spy = vi.spyOn(Buffer, 'byteLength').mockImplementation(((
      input: string,
      encoding?: BufferEncoding,
    ) => {
      if (typeof input === 'string' && input.includes('"schemaVersion"')) return 21_000_000
      return original(input, encoding)
    }) as typeof Buffer.byteLength)

    try {
      let thrown: unknown
      try {
        await scanForHardcodedStrings({ scanPaths: ['src'] }, project.root)
      } catch (error) {
        thrown = error
      }
      expect(thrown instanceof HunterError).toBe(true)
      expect((thrown as HunterError).code).toBe('E_FILE_LIMIT')
      expect((thrown as HunterError).message).toContain('Serialized report exceeds 20MB')
    } finally {
      spy.mockRestore()
    }
  })

  it('returns a bounded report under 20MB for a small fixture', async () => {
    project = createTempProject()
    project.write('src/App.tsx', 'export const App = () => <div>Small fixture</div>')

    const report = await scanForHardcodedStrings({ scanPaths: ['src'] }, project.root)

    expect(report.complete).toBe(true)
    const serialized = JSON.stringify(report)
    expect(Buffer.byteLength(serialized, 'utf8')).toBeLessThan(20_000_000)
  })

  it('keeps limit ceilings at 50k/500M/50k', () => {
    expect(scanLimitCeilings.maxFiles).toBe(50_000)
    expect(scanLimitCeilings.maxTotalBytes).toBe(500_000_000)
    expect(scanLimitCeilings.maxFindings).toBe(50_000)
    expect(() => resolveScanLimits({ maxFiles: 50_001 })).toThrowError(
      expect.objectContaining({ code: 'E_FILE_LIMIT' }),
    )
  })
})
