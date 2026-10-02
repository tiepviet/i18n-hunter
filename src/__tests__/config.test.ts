import { describe, expect, it } from 'vitest'
import { createScannerConfig, defaultScannerConfig } from '../config.js'

describe('scanner config', () => {
  it('defaults to the documented src root and redacts values', () => {
    expect(defaultScannerConfig.scanPaths).toEqual(['src'])
    expect(defaultScannerConfig.includeValues).toBe(false)
  })

  it('excludes dependencies, generated output, tests, and managed state', () => {
    expect(defaultScannerConfig.excludePatterns).toEqual(
      expect.arrayContaining([
        '**/node_modules/**',
        '**/dist/**',
        '**/*.test.*',
        '**/__tests__/**',
        '**/.i18n-hunter/**',
      ]),
    )
  })

  it('creates independent immutable-by-copy configuration', () => {
    const config = createScannerConfig({ scanPaths: ['app'], includeValues: true })
    config.scanPaths.push('other')
    expect(defaultScannerConfig.scanPaths).toEqual(['src'])
    expect(config.includeValues).toBe(true)
  })

  it('propagates stateDir, which discovery relies on to exclude managed state', () => {
    expect(createScannerConfig({ stateDir: 'hunter-state' }).stateDir).toBe('hunter-state')
    expect(createScannerConfig({}).stateDir).toBeUndefined()
  })
})
