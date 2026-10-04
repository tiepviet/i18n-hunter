import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { discoverSourceFiles } from '../discovery.js'
import { canonicalizeRoot } from '../path-policy.js'
import { HunterError } from '../errors.js'
import { createTempProject, type TempProject } from './helpers/temp-project.js'

let project: TempProject | undefined

afterEach(() => project?.cleanup())

describe('discovery edges', () => {
  it('bad-extension direct file emits diagnostic instead of throwing', () => {
    project = createTempProject()
    project.write('src/notes.txt', 'just text')

    let result
    expect(() => {
      result = discoverSourceFiles(project!.root, { scanPaths: ['src/notes.txt'] })
    }).not.toThrow()

    expect(result!.files).toEqual([])
    expect(result!.diagnostics.length).toBeGreaterThan(0)
    expect(result!.diagnostics[0]?.code).toBe('E_PATH_OUTSIDE_ROOT')
    expect(result!.diagnostics[0]?.filePath).toBe('src/notes.txt')
    expect(result!.complete).toBe(false)
  })

  it('src/ trailing slash normalizes instead of E_PATH_OUTSIDE_ROOT', () => {
    project = createTempProject()
    project.write('src/App.tsx', 'export const App = () => <div>Hello</div>')

    const result = discoverSourceFiles(project.root, { scanPaths: ['src/'] })

    expect(result.files).toEqual(['src/App.tsx'])
    expect(result.diagnostics).toEqual([])
    expect(result.complete).toBe(true)
  })

  it('missing root throws E_SCAN_PATH_MISSING', () => {
    const missing = join(tmpdir(), `i18n-hunter-no-such-root-${Date.now()}-${Math.random()}`)

    try {
      canonicalizeRoot(missing)
      expect.unreachable('canonicalizeRoot should throw for missing root')
    } catch (error) {
      expect(error).toBeInstanceOf(HunterError)
      expect((error as HunterError).code).toBe('E_SCAN_PATH_MISSING')
    }

    expect(() => discoverSourceFiles(missing, { scanPaths: ['src'] })).toThrowError(
      expect.objectContaining({ code: 'E_SCAN_PATH_MISSING' }),
    )
  })
})
