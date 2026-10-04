import { lstatSync, realpathSync, statSync } from 'node:fs'
import { extname, isAbsolute, relative, resolve, sep } from 'node:path'
import { HunterError } from './errors.js'

export const sourceExtensions = [
  '.vue',
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mts',
  '.cts',
  '.mjs',
  '.cjs',
] as const

/**
 * Single source of truth for "is this a Vue single-file component?". Discovery
 * accepts case-insensitive extensions, so every consumer must agree: otherwise a
 * `.VUE` file could be scanned with the Vue parser and then transformed with the
 * React/Babel path, producing a misleading failure.
 */
export function isVueSourcePath(filePath: string): boolean {
  return extname(filePath).toLowerCase() === '.vue'
}

/** TypeScript-capable sources (`.ts`/`.tsx`/`.mts`/`.cts`, plus Vue SFC scripts). */
export function isTypeScriptSourcePath(filePath: string): boolean {
  if (isVueSourcePath(filePath)) return true
  const extension = extname(filePath).toLowerCase()
  return extension === '.ts' || extension === '.tsx' || extension === '.mts' || extension === '.cts'
}

/**
 * Sources that may contain JSX syntax and must be parsed/validated with the JSX plugin.
 *
 * `.mts`/`.cts` are intentionally excluded: TypeScript never enables JSX in
 * those extensions, so they are always parsed without the JSX plugin. Plain
 * `.ts` is likewise excluded (use `.tsx` for JSX). `.vue` is handled by the
 * Vue SFC parser, never the Babel JSX path.
 */
export function isJsxSourcePath(filePath: string): boolean {
  const extension = extname(filePath).toLowerCase()
  return (
    extension === '.js' ||
    extension === '.jsx' ||
    extension === '.tsx' ||
    extension === '.mjs' ||
    extension === '.cjs'
  )
}

export function canonicalizeRoot(rootPath: string): string {
  const absolute = resolve(rootPath)
  try {
    return realpathSync.native(absolute)
  } catch {
    throw new HunterError('E_PATH_OUTSIDE_ROOT', `Project root does not exist: ${rootPath}`)
  }
}

export function validatePortableRelativePath(
  value: string,
  allowedExtensions: readonly string[] = sourceExtensions,
): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > 4096 ||
    value.includes('\0') ||
    value.includes('\\') ||
    isAbsolute(value) ||
    /^[A-Za-z][A-Za-z0-9+.-]*:/.test(value)
  ) {
    throw new HunterError('E_PATH_OUTSIDE_ROOT', 'Path must be a portable relative path', value)
  }

  const segments = value.split('/')
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
    throw new HunterError(
      'E_PATH_OUTSIDE_ROOT',
      'Path traversal or empty segment is not allowed',
      value,
    )
  }

  if (allowedExtensions.length > 0) {
    const extension = extname(value).toLowerCase()
    if (!allowedExtensions.map((item) => item.toLowerCase()).includes(extension)) {
      throw new HunterError(
        'E_PATH_OUTSIDE_ROOT',
        `Unsupported source extension: ${extension || '<none>'}`,
        value,
      )
    }
  }

  return value
}

export function isPathInside(rootPath: string, candidatePath: string): boolean {
  const relativePath = relative(rootPath, candidatePath)
  return (
    relativePath === '' ||
    (!relativePath.startsWith(`..${sep}`) && relativePath !== '..' && !isAbsolute(relativePath))
  )
}

export function resolveContainedPath(
  rootPath: string,
  relativePath: string,
  options: { allowMissing?: boolean; allowedExtensions?: readonly string[] } = {},
): { path: string; relativePath: string } {
  const canonicalRoot = canonicalizeRoot(rootPath)
  return resolveContainedPathFromCanonicalRoot(canonicalRoot, relativePath, options)
}

/**
 * Variant of {@link resolveContainedPath} for callers that already hold a
 * canonical root (see {@link canonicalizeRoot}). The scanner resolves thousands
 * of files under one root; re-running `realpathSync` per file is pure overhead,
 * so loops must canonicalize once and reuse this helper.
 */
export function resolveContainedPathFromCanonicalRoot(
  canonicalRoot: string,
  relativePath: string,
  options: { allowMissing?: boolean; allowedExtensions?: readonly string[] } = {},
): { path: string; relativePath: string } {
  const portablePath = validatePortableRelativePath(relativePath, options.allowedExtensions ?? [])
  const candidate = resolve(canonicalRoot, portablePath)

  if (!isPathInside(canonicalRoot, candidate)) {
    throw new HunterError('E_PATH_OUTSIDE_ROOT', 'Path escapes the project root', portablePath)
  }

  assertNoSymlinkComponents(canonicalRoot, candidate, portablePath)

  if (!options.allowMissing) {
    let canonicalCandidate: string
    try {
      canonicalCandidate = realpathSync.native(candidate)
    } catch {
      throw new HunterError('E_PATH_OUTSIDE_ROOT', 'File does not exist', portablePath)
    }

    if (!isPathInside(canonicalRoot, canonicalCandidate)) {
      throw new HunterError(
        'E_PATH_OUTSIDE_ROOT',
        'Resolved path escapes the project root',
        portablePath,
      )
    }
  }

  return { path: candidate, relativePath: portablePath }
}

export function resolveContainedSourcePath(
  rootPath: string,
  relativePath: string,
  allowedExtensions: readonly string[] = sourceExtensions,
): { path: string; relativePath: string } {
  const canonicalRoot = canonicalizeRoot(rootPath)
  return resolveContainedSourcePathFromCanonicalRoot(canonicalRoot, relativePath, allowedExtensions)
}

/**
 * Canonical-root variant of {@link resolveContainedSourcePath}. Prefer this in
 * per-file scan loops where the root was already canonicalized once via
 * {@link canonicalizeRoot}; it skips the redundant per-file `realpathSync`.
 */
export function resolveContainedSourcePathFromCanonicalRoot(
  canonicalRoot: string,
  relativePath: string,
  allowedExtensions: readonly string[] = sourceExtensions,
): { path: string; relativePath: string } {
  const resolved = resolveContainedPathFromCanonicalRoot(canonicalRoot, relativePath, {
    allowedExtensions,
  })

  let stats
  try {
    stats = statSync(resolved.path)
  } catch {
    throw new HunterError('E_PATH_OUTSIDE_ROOT', 'Source file is not readable', relativePath)
  }

  if (!stats.isFile()) {
    throw new HunterError('E_PATH_OUTSIDE_ROOT', 'Source path is not a regular file', relativePath)
  }

  return resolved
}

function assertNoSymlinkComponents(root: string, candidate: string, relativePath: string): void {
  const relativeToRoot = relative(root, candidate)
  if (relativeToRoot === '') return

  const segments = relativeToRoot.split(sep)
  let current = root

  for (const segment of segments) {
    current = resolve(current, segment)
    try {
      if (lstatSync(current).isSymbolicLink()) {
        throw new HunterError(
          'E_SYMLINK_REJECTED',
          'Symlink paths are not allowed in managed paths',
          relativePath,
        )
      }
    } catch (error) {
      if (error instanceof HunterError) throw error
      if (optionsAllowsMissing(error)) return
      throw new HunterError('E_IO', 'Unable to inspect path', relativePath)
    }
  }
}

function optionsAllowsMissing(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
}
