import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { FALLBACK_VERSION } from '../version.js'

describe('version fallback sync', () => {
  it('keeps FALLBACK_VERSION in sync with package.json', () => {
    const pkg = JSON.parse(
      readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
    ) as { version: string }
    expect(FALLBACK_VERSION).toBe(pkg.version)
  })
})
