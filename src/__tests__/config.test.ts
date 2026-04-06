import { describe, it, expect } from 'vitest'
import { defaultScannerConfig, categorizationPatterns } from '../config.js'

describe('config', () => {
  it('has default scan paths', () => {
    expect(defaultScannerConfig.scanPaths).toContain('src/components')
    expect(defaultScannerConfig.scanPaths).toContain('src/pages')
  })

  it('has exclusion patterns for node_modules and tests', () => {
    expect(defaultScannerConfig.excludePatterns).toContain('**/node_modules/**')
    expect(defaultScannerConfig.excludePatterns).toContain('**/*.test.ts')
  })

  it('has categorization patterns for buttons and errors', () => {
    expect(categorizationPatterns.button).toBeDefined()
    expect(categorizationPatterns.error).toBeDefined()
  })
})
