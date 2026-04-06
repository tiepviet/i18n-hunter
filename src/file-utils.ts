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
 * Supports **, *, and ? wildcards.
 */
export function matchesPattern(path: string, patterns: string[]): boolean {
  const normalizedPath = path.replace(/\\/g, '/')
  
  return patterns.some((pattern) => {
    // 1. Escape all regex special chars
    let p = pattern.replace(/[.+*?^${}()|[\]\\]/g, '\\$&')

    // 2. Handle the specific **/ pattern to match zero or more directories
    // We use a safe intermediate marker for escaped **
    p = p.replace(/\\\*\\\*\//g, '(.+/)?') // **/ -> (.*)?/?
    p = p.replace(/\\\/\*\\\*/g, '(/.+)?') // /** -> (/.*)?
    p = p.replace(/\\\*\\\*/g, '.*')       // remaining ** -> .*
    p = p.replace(/\\\*/g, '[^/]*')        // * -> [^/]*
    p = p.replace(/\\\?/g, '.')            // ? -> .

    // 3. Handle brace expansion {vue,ts}
    p = p.replace(/\{([^}]+)\}/g, (_, group) => `(${group.replace(/,/g, '|')})`)

    try {
      const regex = new RegExp(`^${p}$`)
      const regexSuffix = new RegExp(`${p}$`)
      return regex.test(normalizedPath) || regexSuffix.test(normalizedPath)
    } catch {
      return false
    }
  })
}

/**
 * Recursively find all files in a directory that match the patterns.
 */
export function findFiles(
  dirPath: string,
  includePatterns: string[],
  excludePatterns: string[],
  basePath: string,
): string[] {
  if (!existsSync(dirPath)) return []

  try {
    const stats = statSync(dirPath)
    
    if (stats.isFile()) {
      const relativePath = relative(basePath, dirPath)
      if (matchesPattern(relativePath, includePatterns) && !matchesPattern(relativePath, excludePatterns)) {
        return [relativePath]
      }
      return []
    }

    if (!stats.isDirectory()) return []

    const results: string[] = []
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
    return results
  } catch {
    return []
  }
}

export function readFile(filePath: string): string | null {
  try {
    return readFileSync(filePath, 'utf-8')
  } catch {
    return null
  }
}

export function getAllFiles(
  scanPaths: string[],
  includePatterns: string[],
  excludePatterns: string[],
  basePath: string,
): string[] {
  const allFiles: string[] = []
  for (const scanPath of scanPaths) {
    const fullPath = join(basePath, scanPath)
    if (existsSync(fullPath)) {
      allFiles.push(...findFiles(fullPath, includePatterns, excludePatterns, basePath))
    } else {
      const relPath = relative(basePath, fullPath)
      if (matchesPattern(relPath, includePatterns) && !matchesPattern(relPath, excludePatterns)) {
        allFiles.push(relPath)
      }
    }
  }
  return [...new Set(allFiles)]
}
