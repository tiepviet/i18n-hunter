import { createHash } from 'node:crypto'

export interface SourceIndex {
  positionAt(offset: number): { line: number; column: number }
}

export function hashText(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

export function createSourceIndex(source: string): SourceIndex {
  const lineStarts = [0]
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === '\n') lineStarts.push(index + 1)
  }
  return {
    positionAt(offset: number): { line: number; column: number } {
      const boundedOffset = Math.max(0, Math.min(offset, source.length))
      let low = 0
      let high = lineStarts.length
      while (low + 1 < high) {
        const middle = Math.floor((low + high) / 2)
        if (lineStarts[middle]! <= boundedOffset) low = middle
        else high = middle
      }
      return { line: low + 1, column: boundedOffset - lineStarts[low]! }
    },
  }
}

export function positionAt(source: string, offset: number): { line: number; column: number } {
  return createSourceIndex(source).positionAt(offset)
}

export function trimRange(
  raw: string,
): { value: string; leading: number; trailing: number } | undefined {
  const leading = raw.length - raw.trimStart().length
  const trailing = raw.length - raw.trimEnd().length
  const value = raw.trim()
  return value ? { value, leading, trailing } : undefined
}
