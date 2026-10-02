import { defaultExcludePatterns, defaultIncludePatterns } from './discovery.js'
import { defaultScanLimits } from './limits.js'
import type { ScannerConfig } from './types.js'

export const defaultScannerConfig: Readonly<ScannerConfig> = Object.freeze({
  scanPaths: ['src'],
  includePatterns: [...defaultIncludePatterns],
  excludePatterns: [...defaultExcludePatterns],
  limits: { ...defaultScanLimits },
  includeValues: false,
  readableKeys: false,
})

export function createScannerConfig(overrides: Partial<ScannerConfig> = {}): ScannerConfig {
  return {
    scanPaths: [...(overrides.scanPaths ?? defaultScannerConfig.scanPaths)],
    includePatterns: [...(overrides.includePatterns ?? defaultScannerConfig.includePatterns)],
    excludePatterns: [...(overrides.excludePatterns ?? defaultScannerConfig.excludePatterns)],
    limits: {
      ...defaultScannerConfig.limits,
      ...Object.fromEntries(
        Object.entries(overrides.limits ?? {}).filter(([, value]) => value !== undefined),
      ),
    },
    includeValues: overrides.includeValues ?? defaultScannerConfig.includeValues,
    readableKeys: overrides.readableKeys ?? defaultScannerConfig.readableKeys,
    stateDir: overrides.stateDir,
  }
}
