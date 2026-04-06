import { describe, it, expect } from 'vitest'
import { matchesPattern } from '../file-utils.js'

describe('matchesPattern', () => {
  it('matches exact filename', () => {
    expect(matchesPattern('foo.vue', ['foo.vue'])).toBe(true)
  })

  it('matches glob with **', () => {
    expect(matchesPattern('src/features/Foo.vue', ['**/*.vue'])).toBe(true)
  })

  it('matches node_modules exclusion', () => {
    expect(matchesPattern('node_modules/pkg/index.js', ['**/node_modules/**'])).toBe(true)
  })

  it('does not match non-vue file', () => {
    expect(matchesPattern('src/foo.ts', ['**/*.vue'])).toBe(false)
  })
})
