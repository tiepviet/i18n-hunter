import { afterEach, describe, expect, it } from 'vitest'
import {
  isVueSourcePath,
  resolveContainedSourcePath,
  validatePortableRelativePath,
} from '../path-policy.js'
import { createTempProject, type TempProject } from './helpers/temp-project.js'

let project: TempProject | undefined

afterEach(() => project?.cleanup())

describe('path policy', () => {
  it('agrees case-insensitively on the Vue extension', () => {
    expect(isVueSourcePath('src/App.vue')).toBe(true)
    expect(isVueSourcePath('src/App.VUE')).toBe(true)
    expect(isVueSourcePath('src/App.Vue')).toBe(true)
    expect(isVueSourcePath('src/App.tsx')).toBe(false)
    expect(isVueSourcePath('src/vue.ts')).toBe(false)
    expect(isVueSourcePath('src/App.vue.tsx')).toBe(false)
  })

  it.each([
    '../outside.ts',
    '/absolute.ts',
    'src\\Windows.ts',
    'src/../../outside.ts',
    'https://example.com/file.ts',
    'src/file.ts\u0000',
  ])('rejects non-portable report path %j', (value) => {
    expect(() => validatePortableRelativePath(value, ['.ts'])).toThrow()
  })

  it('resolves a regular source file beneath the canonical root', () => {
    project = createTempProject()
    const sourcePath = project.write('src/App.tsx', 'export const App = () => null')

    const resolved = resolveContainedSourcePath(project!.root, 'src/App.tsx')

    expect(resolved.path).toBe(sourcePath)
  })

  it('rejects a source symlink that escapes the root', async () => {
    project = createTempProject()
    const outside = createTempProject('i18n-hunter-outside-')
    const { symlinkSync } = await import('node:fs')
    project.mkdir('src')
    outside.write('secret.ts', 'export const secret = true')
    symlinkSync(outside.root, project!.root + '/src/linked', 'dir')

    expect(() => resolveContainedSourcePath(project!.root, 'src/linked/secret.ts')).toThrow(
      /symlink/i,
    )

    outside.cleanup()
  })
})
