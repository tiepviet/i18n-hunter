import { closeSync, constants, fstatSync, lstatSync, openSync, readSync } from 'node:fs'
import { HunterError } from './errors.js'

export function readTextFileBounded(path: string, maxBytes: number): string {
  const pathStats = lstatSync(path)
  if (pathStats.isSymbolicLink() || !pathStats.isFile()) {
    throw new HunterError('E_IO', `Expected a regular non-symlink file: ${path}`, path)
  }

  const noFollow = typeof constants.O_NOFOLLOW === 'number' ? constants.O_NOFOLLOW : 0
  const descriptor = openSync(path, constants.O_RDONLY | noFollow)
  try {
    const stats = fstatSync(descriptor)
    if (!stats.isFile() || stats.dev !== pathStats.dev || stats.ino !== pathStats.ino) {
      throw new HunterError('E_IO', `File changed while opening: ${path}`, path)
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
