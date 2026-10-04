import picomatch from 'picomatch'
import { discoverSourceFiles, type DiscoveryOptions, type DiscoveryResult } from './discovery.js'
import type { ScanLimits } from './types.js'

export function matchesPattern(path: string, patterns: string[]): boolean {
  const normalizedPath = path.replace(/\\/gu, '/')
  return picomatch(patterns, { dot: false })(normalizedPath)
}

export function findFiles(
  dirPath: string,
  includePatterns: string[] = [],
  excludePatterns: string[] = [],
  basePath: string,
  limits?: Partial<ScanLimits>,
  stateDir?: string,
): DiscoveryResult {
  return discoverSourceFiles(basePath, {
    scanPaths: [dirPath],
    includePatterns,
    excludePatterns,
    limits,
    ...(stateDir ? { stateDir } : {}),
  })
}

export function getAllFiles(
  scanPaths: string[],
  includePatterns: string[] = [],
  excludePatterns: string[] = [],
  basePath: string,
  limits?: Partial<ScanLimits>,
  stateDir?: string,
): DiscoveryResult {
  const options: DiscoveryOptions = {
    scanPaths,
    includePatterns,
    excludePatterns,
    limits,
    ...(stateDir ? { stateDir } : {}),
  }
  return discoverSourceFiles(basePath, options)
}
