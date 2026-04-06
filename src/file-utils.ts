/**
 * File System Utilities
 *
 * Utilities for discovering and reading source files during scanning.
 */

import { readdirSync, statSync, readFileSync, existsSync } from 'node:fs'
import { join, relative } from 'node:path'

/**
 * Test whether a path matches any of the given glob-style patterns.
 *
 * Supports `**`, `*`, and `?` wildcards.
 */
export function matchesPattern(path: string, patterns: string[]): boolean {
  return patterns.some((pattern) => {
    // Basic glob to regex conversion
    let regexStr = pattern
      .replace(/\./g, '\\.')
      .replace(/\*\*/g, '(.+)')
      .replace(/\*/g, '([^/]+)')
      .replace(/\?/g, '(.)')

    // Handle brace expansion like {vue,ts,tsx}
    const braceRegex = /\{([^}]+)\}/g
    regexStr = regexStr.replace(braceRegex, (_, group) => {
      return `(${group.replace(/,/g, '|')})`
    })

    return new RegExp(`^${regexStr}$`).test(path) || new RegExp(`${regexStr}$`).test(path)
  })
}

/**
 * Recursively find all files in a directory that match the patterns.
 * Also supports direct file paths.
 */
export function findFiles(
  dirPath: string,
  includePatterns: string[],
  excludePatterns: string[],
  basePath: string,
): string[] {
  if (!existsSync(dirPath)) return []

  const stats = statSync(dirPath)
  
  // If it's already a file, check if it matches includes
  if (stats.isFile()) {
    const relativePath = relative(basePath, dirPath)
    if (matchesPattern(relativePath, includePatterns) && !matchesPattern(relativePath, excludePatterns)) {
      return [relativePath]
    }
    return []
  }

  if (!stats.isDirectory()) return []

  const results: string[] = []
  try {
    const entries = readdirSync(dirPath)

    for (const entry of entries) {
      const fullPath = join(dirPath, entry)
      const relativePath = relative(basePath, fullPath)

      if (matchesPattern(relativePath, excludePatterns)) continue

      const stat = statSync(fullPath)

      if (stat.isDirectory()) {
        results.push(...findFiles(fullPath, includePatterns, excludePatterns, basePath))
      } else if (stat.isFile() && matchesPattern(relativePath, includePatterns)) {
        results.push(relativePath)
      }
    }
  } catch {
    // Silently skip unreadable directories (permissions, symlinks, etc.)
  }

  return results
}

/**
 * Read a file and return its content.
 * Returns `null` when the file cannot be read.
 */
export function readFile(filePath: string): string | null {
  try {
    return readFileSync(filePath, 'utf-8')
  } catch {
    return null
  }
}

/**
 * Collect all files mapping to the supported extensions from multiple `scanPaths` relative to `basePath`.
 */
export function getAllFiles(
  scanPaths: string[],
  includePatterns: string[],
  excludePatterns: string[],
  basePath: string,
): string[] {
  return scanPaths.flatMap((scanPath) =>
    findFiles(join(basePath, scanPath), includePatterns, excludePatterns, basePath),
  )
}
