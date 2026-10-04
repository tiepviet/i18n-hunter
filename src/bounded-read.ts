import { closeSync, constants, fstatSync, lstatSync, openSync, readSync } from 'node:fs'
import { HunterError } from './errors.js'

export function readTextFileBounded(path: string, maxBytes: number): string {
  let pathStats
  try {
    pathStats = lstatSync(path)
  } catch {
    throw new HunterError('E_IO', `File not found or not readable: ${path}`, path)
  }
  if (pathStats.isSymbolicLink() || !pathStats.isFile()) {
    throw new HunterError('E_IO', `Expected a regular non-symlink file: ${path}`, path)
  }

  let descriptor: number
  try {
    // O_NOFOLLOW is unavailable on Windows (constants.O_NOFOLLOW is undefined,
    // so the fallback 0 silently follows symlinks). The dev/ino comparison
    // after open is the primary TOCTOU guard on POSIX; on Windows dev/ino are
    // both 0 so that comparison is vacuous — see the post-open re-lstat below.
    const noFollow = typeof constants.O_NOFOLLOW === 'number' ? constants.O_NOFOLLOW : 0
    descriptor = openSync(path, constants.O_RDONLY | noFollow)
  } catch {
    throw new HunterError('E_IO', `File not found or not readable: ${path}`, path)
  }
  try {
    const stats = fstatSync(descriptor)
    if (!stats.isFile() || stats.dev !== pathStats.dev || stats.ino !== pathStats.ino) {
      throw new HunterError('E_IO', `File changed while opening: ${path}`, path)
    }
    // Windows limitation: dev/ino are both 0, so a symlink swapped in between
    // the pre-open lstat and open() would still pass the check above.
    // Re-lstat after open as best-effort mitigation — if the path is currently
    // a symlink (or no longer a regular file), refuse. This narrows but does
    // not fully close the TOCTOU window on Windows (see docs/security-model.md).
    if (stats.dev === 0 && stats.ino === 0) {
      const fresh = lstatSync(path)
      if (fresh.isSymbolicLink() || !fresh.isFile()) {
        throw new HunterError('E_IO', `Expected a regular non-symlink file: ${path}`, path)
      }
    }
    if (stats.size > maxBytes) {
      throw new HunterError('E_FILE_LIMIT', `File exceeds ${maxBytes} bytes: ${path}`, path)
    }

    const buffer = Buffer.alloc(stats.size)
    let offset = 0
    while (offset < buffer.length) {
      const read = readSync(descriptor, buffer, offset, buffer.length - offset, offset)
      if (read === 0) break
      offset += read
    }
    return buffer.toString('utf8')
  } finally {
    closeSync(descriptor)
  }
}
