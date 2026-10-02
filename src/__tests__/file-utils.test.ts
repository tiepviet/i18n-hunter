import { afterEach, describe, expect, it } from 'vitest'
import { findFiles, matchesPattern } from '../file-utils.js'
import { createTempProject, type TempProject } from './helpers/temp-project.js'

let project: TempProject | undefined

afterEach(() => project?.cleanup())

describe('file utilities', () => {
  it('matches real source extensions without matching directories, packages, or backups', () => {
    const patterns = ['**/*.{vue,ts,tsx,js,jsx}']
    expect(matchesPattern('src/App.tsx', patterns)).toBe(true)
    expect(matchesPattern('src/components/Button.vue', patterns)).toBe(true)
    expect(matchesPattern('src/components', patterns)).toBe(false)
    expect(matchesPattern('package.json', patterns)).toBe(false)
    expect(matchesPattern('src/App.tsx.bak', patterns)).toBe(false)
  })

  it('returns discovery diagnostics instead of hiding unsafe files', () => {
    project = createTempProject()
    project.write('src/value.ts', 'export const value = 1')
    const result = findFiles('src', [], ['**/generated/**'], project.root)
    expect(result.files).toEqual(['src/value.ts'])
    expect(result.complete).toBe(true)
  })
})
