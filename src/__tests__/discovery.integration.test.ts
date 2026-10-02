import { symlinkSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { discoverSourceFiles } from '../discovery.js'
import { createTempProject, type TempProject } from './helpers/temp-project.js'

let project: TempProject | undefined

afterEach(() => project?.cleanup())

describe('source discovery', () => {
  it('finds supported root and nested source files with defaults', () => {
    project = createTempProject()
    project.write('src/App.vue', '<template><div>Hello</div></template>')
    project.write('src/components/Button.tsx', 'export const Button = () => <button>Save</button>')
    project.write('src/util.ts', 'export const value = 1')
    project.write('package.json', '{}')
    project.write('src/Button.test.tsx', 'export const test = true')
    project.write('node_modules/pkg/index.ts', 'export const dependency = true')

    const result = discoverSourceFiles(project.root, { scanPaths: ['src'] })

    expect(result.files).toEqual(['src/App.vue', 'src/components/Button.tsx', 'src/util.ts'])
    expect(result.diagnostics).toEqual([])
  })

  it('keeps safety exclusions when custom excludes are supplied', () => {
    project = createTempProject()
    project.write('src/App.tsx', 'export const App = () => <div>Hello</div>')
    project.write('node_modules/pkg/index.ts', 'export const dependency = true')
    project.write('dist/bundle.ts', 'export const bundled = true')
    project.write('src/custom/keep.ts', 'export const keep = true')

    const result = discoverSourceFiles(project.root, {
      scanPaths: ['.'],
      excludePatterns: ['**/generated/**'],
    })

    expect(result.files).toEqual(['src/App.tsx', 'src/custom/keep.ts'])
  })

  it('never scans a managed state directory, whatever it is named', () => {
    project = createTempProject()
    project.write('src/App.tsx', 'export const App = () => <div>Hello</div>')
    project.write('src/.state/transactions/t/backups/src/App.tsx', 'export const backup = true')

    const result = discoverSourceFiles(project.root, {
      scanPaths: ['.'],
      stateDir: '.state',
    })

    expect(result.files).toEqual(['src/App.tsx'])
  })

  it('reports a missing scan path instead of returning it as a file', () => {
    project = createTempProject()

    const result = discoverSourceFiles(project.root, { scanPaths: ['missing'] })

    expect(result.files).toEqual([])
    expect(result.diagnostics[0]?.code).toBe('E_SCAN_PATH_MISSING')
  })

  it('deduplicates overlapping scan roots', () => {
    project = createTempProject()
    project.write('src/App.tsx', 'export const App = () => <div>Hello</div>')

    const result = discoverSourceFiles(project.root, { scanPaths: ['src', 'src/App.tsx'] })

    expect(result.files).toEqual(['src/App.tsx'])
  })

  it('rejects traversal and symlink scan roots', () => {
    project = createTempProject()
    const outside = createTempProject('i18n-hunter-discovery-outside-')
    project.mkdir('src')
    symlinkSync(outside.root, join(project.root, 'src/linked'), 'dir')

    const result = discoverSourceFiles(project.root, { scanPaths: ['../outside', 'src/linked'] })

    expect(result.files).toEqual([])
    expect(result.diagnostics.map((item) => item.code)).toEqual(
      expect.arrayContaining(['E_PATH_OUTSIDE_ROOT', 'E_SYMLINK_REJECTED']),
    )
    outside.cleanup()
  })

  it('marks symlinks found inside a scanned tree as incomplete', () => {
    project = createTempProject()
    const outside = createTempProject('i18n-hunter-inner-symlink-')
    project.write('src/Real.tsx', 'export const Real = () => <div>Real message</div>')
    outside.write('src/Linked.tsx', 'export const Linked = () => <div>Linked message</div>')
    symlinkSync(outside.root, join(project.root, 'src/linked'), 'dir')
    symlinkSync(outside.root + '/src/Linked.tsx', join(project.root, 'src/Host.tsx'))

    const result = discoverSourceFiles(project.root, { scanPaths: ['src'] })

    expect(result.complete).toBe(false)
    expect(
      result.diagnostics.filter((item) => item.code === 'E_SYMLINK_REJECTED').length,
    ).toBeGreaterThanOrEqual(2)
    outside.cleanup()
  })

  it('marks file-limit exhaustion incomplete', () => {
    project = createTempProject()
    project.write('src/A.tsx', 'export const A = 1')
    project.write('src/B.tsx', 'export const B = 2')

    const result = discoverSourceFiles(project.root, {
      scanPaths: ['src'],
      limits: { maxFiles: 1 },
    })

    expect(result.files).toHaveLength(1)
    expect(result.complete).toBe(false)
    expect(result.diagnostics[0]?.code).toBe('E_FILE_LIMIT')
  })
})
