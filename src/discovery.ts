import { existsSync, lstatSync, readdirSync } from 'node:fs'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import picomatch from 'picomatch'
import { globSync } from 'tinyglobby'
import { HunterError } from './errors.js'
import { resolveScanLimits } from './limits.js'
import { canonicalizeRoot, sourceExtensions, validatePortableRelativePath } from './path-policy.js'
import type { Diagnostic, ScanLimits } from './types.js'

export interface DiscoveryOptions {
  scanPaths: string[]
  includePatterns?: string[]
  excludePatterns?: string[]
  limits?: Partial<ScanLimits>
  /** Absolute or project-relative managed state directory that must never be scanned. */
  stateDir?: string
}

export interface DiscoveryResult {
  files: string[]
  diagnostics: Diagnostic[]
  limits: ScanLimits
  complete: boolean
}

export const defaultIncludePatterns = ['**/*.{vue,ts,tsx,js,jsx,mts,cts,mjs,cjs}']
export const defaultExcludePatterns = [
  '**/node_modules/**',
  '**/.git/**',
  '**/dist/**',
  '**/build/**',
  '**/coverage/**',
  '**/.next/**',
  '**/.nuxt/**',
  '**/out/**',
  '**/target/**',
  '**/i18n-reports/**',
  '**/.i18n-hunter/**',
  '**/__tests__/**',
  '**/__mocks__/**',
  '**/*.test.*',
  '**/*.spec.*',
]

export function discoverSourceFiles(basePath: string, options: DiscoveryOptions): DiscoveryResult {
  const root = canonicalizeRoot(basePath)
  const limits = resolveScanLimits(options.limits)
  const requestedIncludes = options.includePatterns ?? []
  const requestedExcludes = options.excludePatterns ?? []
  const includePatterns = requestedIncludes.length > 0 ? requestedIncludes : defaultIncludePatterns
  const stateRelativePath = resolveStateRelativePath(root, options.stateDir)
  const mandatoryExcludes = stateRelativePath ? [`${escapeGlob(stateRelativePath)}/**`] : []
  const excludePatterns = [
    ...new Set([...defaultExcludePatterns, ...mandatoryExcludes, ...requestedExcludes]),
  ]
  const diagnostics: Diagnostic[] = []
  const found = new Set<string>()

  if (options.scanPaths.length === 0) {
    diagnostics.push({
      severity: 'error',
      code: 'E_SCAN_PATH_MISSING',
      message: 'At least one scan path is required',
    })
    return { files: [], diagnostics, limits, complete: false }
  }

  for (const scanPath of options.scanPaths) {
    const safeScanPath = normalizeScanPath(scanPath)
    if (
      isAbsolute(safeScanPath) ||
      safeScanPath.split('/').some((segment) => segment === '..' || segment === '')
    ) {
      diagnostics.push({
        severity: 'error',
        code: 'E_PATH_OUTSIDE_ROOT',
        message: `Scan path must stay within the project root: ${safeScanPath}`,
        filePath: safeScanPath,
      })
      continue
    }
    const fullScanPath = resolve(root, safeScanPath)
    const relativeScanPath = relative(root, fullScanPath)
    if (relativeScanPath.startsWith(`..${sep}`) || isAbsolute(relativeScanPath)) {
      diagnostics.push({
        severity: 'error',
        code: 'E_PATH_OUTSIDE_ROOT',
        message: `Scan path escapes the project root: ${safeScanPath}`,
        filePath: safeScanPath,
      })
      continue
    }

    if (!existsSync(fullScanPath)) {
      diagnostics.push({
        severity: 'error',
        code: 'E_SCAN_PATH_MISSING',
        message: `Scan path does not exist: ${safeScanPath}`,
        filePath: safeScanPath,
      })
      continue
    }

    const stats = lstatSync(fullScanPath)
    if (stats.isSymbolicLink()) {
      diagnostics.push({
        severity: 'error',
        code: 'E_SYMLINK_REJECTED',
        message: `Scan path symlink is not allowed: ${safeScanPath}`,
        filePath: safeScanPath,
      })
      continue
    }

    if (stats.isFile()) {
      if (lstatSync(fullScanPath).isSymbolicLink()) {
        diagnostics.push({
          severity: 'error',
          code: 'E_SYMLINK_REJECTED',
          message: `Scan path symlink is not allowed: ${safeScanPath}`,
          filePath: safeScanPath,
        })
        continue
      }
      // A direct file scan path must still respect the managed-state exclusion.
      if (
        stateRelativePath &&
        (safeScanPath.toLowerCase() === stateRelativePath.toLowerCase() ||
          safeScanPath.toLowerCase().startsWith(`${stateRelativePath.toLowerCase()}/`))
      ) {
        diagnostics.push({
          severity: 'error',
          code: 'E_PATH_OUTSIDE_ROOT',
          message: `Scan path is managed transaction state: ${safeScanPath}`,
          filePath: safeScanPath,
        })
        continue
      }
      try {
        validatePortableRelativePath(safeScanPath, sourceExtensions)
        found.add(safeScanPath)
      } catch (error) {
        diagnostics.push({
          severity: 'error',
          code: error instanceof HunterError ? error.code : 'E_PATH_OUTSIDE_ROOT',
          message: error instanceof Error ? error.message : String(error),
          filePath: safeScanPath,
        })
      }
      continue
    }

    if (!stats.isDirectory()) {
      diagnostics.push({
        severity: 'warning',
        code: 'E_SCAN_PATH_MISSING',
        message: `Scan path is not a file or directory: ${safeScanPath}`,
        filePath: safeScanPath,
      })
      continue
    }

    const matchesInclude = picomatch(includePatterns, { dot: false })
    const matchesExclude = picomatch(excludePatterns, { dot: false })
    const pattern = safeScanPath === '.' ? '**/*' : `${safeScanPath}/**/*`
    const matches = globSync(pattern, {
      cwd: root,
      onlyFiles: true,
      dot: false,
      followSymbolicLinks: false,
      deep: limits.maxDepth,
      ignore: excludePatterns,
    })

    for (const match of matches) {
      const relativePath = match.split('\\').join('/')
      if (!matchesInclude(relativePath) || matchesExclude(relativePath)) continue
      try {
        validatePortableRelativePath(relativePath, sourceExtensions)
        const fullPath = resolve(root, relativePath)
        if (!lstatSync(fullPath).isFile()) continue
        found.add(relativePath)
      } catch (error) {
        diagnostics.push({
          severity: 'error',
          code: error instanceof HunterError ? error.code : 'E_PATH_OUTSIDE_ROOT',
          message: error instanceof Error ? error.message : String(error),
          filePath: relativePath,
        })
      }
    }
  }

  diagnostics.push(
    ...findSymlinkDiagnostics(root, options.scanPaths, excludePatterns, limits.maxDepth),
  )

  if (depthLimitReached(root, options.scanPaths, excludePatterns, limits.maxDepth)) {
    diagnostics.push({
      severity: 'error',
      code: 'E_FILE_LIMIT',
      message: `Discovery depth limit reached (${limits.maxDepth}); scan is incomplete`,
    })
  }

  const sorted = [...found].sort((left, right) => left.localeCompare(right))
  const files = sorted.slice(0, limits.maxFiles)
  if (sorted.length > limits.maxFiles) {
    diagnostics.push({
      severity: 'error',
      code: 'E_FILE_LIMIT',
      message: `File limit exceeded: discovered ${sorted.length}, processing ${limits.maxFiles}`,
    })
  }

  return {
    files,
    diagnostics,
    limits,
    complete: diagnostics.every((diagnostic) => diagnostic.severity !== 'error'),
  }
}

function findSymlinkDiagnostics(
  root: string,
  scanPaths: string[],
  excludePatterns: string[],
  maxDepth: number,
): Diagnostic[] {
  const diagnostics: Diagnostic[] = []
  const excluded = picomatch(excludePatterns, { dot: false })

  const visit = (directory: string, depth: number): void => {
    if (depth > maxDepth) return
    let entries
    try {
      entries = readdirSync(directory, { withFileTypes: true })
    } catch {
      diagnostics.push({
        severity: 'error',
        code: 'E_IO',
        message: `Unable to read directory during discovery: ${relative(root, directory).split(sep).join('/') || '.'}`,
      })
      return
    }
    for (const entry of entries) {
      const relativePath = relative(root, join(directory, entry.name)).split(sep).join('/')
      if (excluded(relativePath)) continue
      if (entry.isSymbolicLink()) {
        diagnostics.push({
          severity: 'error',
          code: 'E_SYMLINK_REJECTED',
          message: `Symlink encountered during discovery: ${relativePath}`,
          filePath: relativePath,
        })
        continue
      }
      if (entry.isDirectory()) visit(join(directory, entry.name), depth + 1)
    }
  }

  for (const scanPath of scanPaths) {
    const normalized = normalizeScanPath(scanPath)
    if (normalized === '.') {
      visit(root, 0)
      continue
    }
    const directory = resolve(root, normalized)
    if (
      existsSync(directory) &&
      lstatSync(directory).isDirectory() &&
      !lstatSync(directory).isSymbolicLink()
    ) {
      visit(directory, 0)
    }
  }
  return diagnostics
}

function depthLimitReached(
  root: string,
  scanPaths: string[],
  excludePatterns: string[],
  maxDepth: number,
): boolean {
  const excluded = picomatch(excludePatterns, { dot: false })
  const visit = (directory: string, depth: number): boolean => {
    if (depth < maxDepth) {
      let entries
      try {
        entries = readdirSync(directory, { withFileTypes: true })
      } catch {
        return false
      }
      for (const entry of entries) {
        const relativePath = relative(root, join(directory, entry.name)).split(sep).join('/')
        if (excluded(relativePath)) continue
        if (entry.isSymbolicLink()) continue
        if (entry.isDirectory() && visit(join(directory, entry.name), depth + 1)) return true
      }
      return false
    }
    // At the depth limit: any non-excluded subdirectory means truncation.
    let entries
    try {
      entries = readdirSync(directory, { withFileTypes: true })
    } catch {
      return false
    }
    return entries.some((entry) => {
      if (!entry.isDirectory() || entry.isSymbolicLink()) return false
      const relativePath = relative(root, join(directory, entry.name)).split(sep).join('/')
      return !excluded(relativePath)
    })
  }

  for (const scanPath of scanPaths) {
    const normalized = normalizeScanPath(scanPath)
    const directory = normalized === '.' ? root : resolve(root, normalized)
    if (
      existsSync(directory) &&
      lstatSync(directory).isDirectory() &&
      !lstatSync(directory).isSymbolicLink() &&
      visit(directory, 0)
    ) {
      return true
    }
  }
  return false
}

/**
 * Resolves the managed state directory to a portable, root-relative path when it
 * lives inside the scanned project. Returns `undefined` for external state
 * directories, which discovery can never reach anyway.
 */
export function resolveStateRelativePath(root: string, stateDir?: string): string | undefined {
  if (!stateDir) return undefined
  const absolute = isAbsolute(stateDir) ? resolve(stateDir) : resolve(root, stateDir)
  const relativePath = relative(root, absolute)
  if (
    !relativePath ||
    relativePath === '.' ||
    relativePath.startsWith(`..${sep}`) ||
    isAbsolute(relativePath)
  ) {
    return undefined
  }
  return relativePath.split(sep).join('/')
}

function normalizeScanPath(path: string): string {
  if (path === '' || path === '.' || path === './') return '.'
  let normalized = path
  if (normalized.startsWith('./')) normalized = normalized.slice(2)
  while (normalized.endsWith('/') && normalized.length > 1) {
    normalized = normalized.slice(0, -1)
  }
  if (normalized === '' || normalized === '.') return '.'
  return normalized
}

function escapeGlob(value: string): string {
  return value.replace(/[*?[\]{}()!+@]/gu, (character) => `\\${character}`)
}

export function fileSize(path: string): number {
  return lstatSync(path).size
}
