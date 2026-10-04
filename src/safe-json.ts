import { closeSync, constants, fstatSync, lstatSync, openSync, readSync } from 'node:fs'
import { HunterError } from './errors.js'

export const defaultMaxJsonBytes = 25_000_000

function assertNoDuplicateJsonKeys(text: string): void {
  let index = 0
  let depth = 0

  const skipWhitespace = (): void => {
    while (/\s/u.test(text[index] ?? '')) index += 1
  }
  const parseString = (): string => {
    if (text[index] !== '"') throw new Error('Expected JSON string')
    const start = index
    index += 1
    while (index < text.length) {
      if (text[index] === '\\') {
        index += 2
        continue
      }
      if (text[index] === '"') {
        index += 1
        return text.slice(start, index)
      }
      index += 1
    }
    throw new Error('Unterminated JSON string')
  }
  const parseValue = (): void => {
    if (depth++ > 1000) throw new Error('JSON nesting limit exceeded')
    skipWhitespace()
    const character = text[index]
    if (character === '{') {
      index += 1
      const keys = new Set<string>()
      skipWhitespace()
      if (text[index] === '}') {
        index += 1
        depth--
        return
      }
      while (index < text.length) {
        const rawKey = parseString()
        const key = JSON.parse(rawKey) as string
        if (keys.has(key)) throw new Error(`Duplicate JSON key: ${key}`)
        keys.add(key)
        skipWhitespace()
        if (text[index] !== ':') throw new Error('Expected JSON colon')
        index += 1
        parseValue()
        skipWhitespace()
        if (text[index] === '}') {
          index += 1
          depth--
          return
        }
        if (text[index] !== ',') throw new Error('Expected JSON comma')
        index += 1
        skipWhitespace()
      }
      throw new Error('Unterminated JSON object')
    }
    if (character === '[') {
      index += 1
      skipWhitespace()
      if (text[index] === ']') {
        index += 1
        depth--
        return
      }
      while (index < text.length) {
        parseValue()
        skipWhitespace()
        if (text[index] === ']') {
          index += 1
          depth--
          return
        }
        if (text[index] !== ',') throw new Error('Expected JSON array comma')
        index += 1
      }
      throw new Error('Unterminated JSON array')
    }
    if (character === '"') {
      parseString()
      depth--
      return
    }
    const start = index
    while (index < text.length && !/[\s,}\]]/u.test(text[index]!)) index += 1
    if (start === index) throw new Error('Expected JSON value')
    depth--
  }

  parseValue()
  skipWhitespace()
  if (index !== text.length) throw new Error('Unexpected JSON trailing data')
}

export function readJsonBounded(path: string, maxBytes = defaultMaxJsonBytes): unknown {
  let pathStats
  try {
    pathStats = lstatSync(path)
  } catch {
    throw new HunterError('E_JSON_INVALID', `File not found or not readable: ${path}`)
  }
  if (pathStats.isSymbolicLink() || !pathStats.isFile()) {
    throw new HunterError('E_JSON_INVALID', `Expected a regular non-symlink JSON file: ${path}`)
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
    throw new HunterError('E_JSON_INVALID', `File not found or not readable: ${path}`)
  }

  try {
    const stats = fstatSync(descriptor)
    if (!stats.isFile() || stats.dev !== pathStats.dev || stats.ino !== pathStats.ino) {
      throw new HunterError('E_JSON_INVALID', `JSON file changed while opening: ${path}`)
    }
    // Windows limitation: dev/ino are both 0, so a symlink swapped in between
    // the pre-open lstat and open() would still pass the check above.
    // Re-lstat after open as best-effort mitigation — if the path is currently
    // a symlink (or no longer a regular file), refuse. This narrows but does
    // not fully close the TOCTOU window on Windows (see docs/security-model.md).
    if (stats.dev === 0 && stats.ino === 0) {
      const fresh = lstatSync(path)
      if (fresh.isSymbolicLink() || !fresh.isFile()) {
        throw new HunterError('E_JSON_INVALID', `Expected a regular non-symlink JSON file: ${path}`)
      }
    }
    if (stats.size > maxBytes)
      throw new HunterError('E_JSON_TOO_LARGE', `JSON file exceeds ${maxBytes} bytes`)

    const buffer = Buffer.alloc(stats.size)
    let offset = 0
    while (offset < buffer.length) {
      const read = readSync(descriptor, buffer, offset, buffer.length - offset, offset)
      if (read === 0) break
      offset += read
    }
    const text = buffer.toString('utf8')
    try {
      assertNoDuplicateJsonKeys(text)
      return JSON.parse(text)
    } catch {
      throw new HunterError('E_JSON_INVALID', `Invalid JSON in ${path}`)
    }
  } finally {
    closeSync(descriptor)
  }
}
