import { describe, expect, it } from 'vitest'
import { HunterError } from '../errors.js'
import { applyTextEdits, type TextEdit } from '../text-edit.js'

const source = '0123456789'

function insertion(start: number, replacement: string, groupId = 'g'): TextEdit {
  return { range: { start, end: start }, replacement, kind: 'hook', groupId }
}

function finding(start: number, end: number, replacement: string, groupId = 'g'): TextEdit {
  return { range: { start, end }, replacement, kind: 'finding', groupId }
}

describe('applyTextEdits', () => {
  it('applies edits right-to-left so earlier offsets stay valid', () => {
    const result = applyTextEdits(source, [
      insertion(2, 'AA'),
      finding(5, 8, 'RRR'),
      insertion(1, 'B'),
    ])
    // source 0123456789: insert 'B' at 1, insert 'AA' at 2, replace '567' with 'RRR'
    expect(result).toBe('0B1AA234RRR89')
  })

  it('applies a spanning edit before an insertion at the same offset', () => {
    // The insertion must not land inside the replacement.
    expect(applyTextEdits(source, [insertion(3, 'INS'), finding(3, 8, 'RRR')])).toBe('012INSRRR89')
  })

  it('emits co-located insertions in reverse planned order', () => {
    // Documented consequence of applying right-to-left with a stable sort.
    expect(applyTextEdits(source, [insertion(3, 'AA'), insertion(3, 'BB')])).toBe('012BBAA3456789')
  })

  it('keeps an insertion exactly at a boundary rather than rejecting it', () => {
    expect(applyTextEdits(source, [finding(3, 8, 'RRR'), insertion(3, '|')])).toBe('012|RRR89')
    expect(applyTextEdits(source, [finding(3, 8, 'RRR'), insertion(8, '|')])).toBe('012RRR|89')
  })

  it('rejects an insertion strictly inside a spanning edit', () => {
    expect(() => applyTextEdits(source, [finding(3, 8, 'RRR'), insertion(5, 'INS')])).toThrow(
      HunterError,
    )
  })

  it('rejects two overlapping spanning edits', () => {
    expect(() => applyTextEdits(source, [finding(2, 6, 'A'), finding(5, 9, 'B')])).toThrow(
      /overlap/i,
    )
  })

  it('normalizes inserted newlines to the source line ending', () => {
    const crlf = 'a\r\nb'
    expect(applyTextEdits(crlf, [insertion(1, 'X\nY')])).toBe('aX\r\nY\r\nb')
    expect(applyTextEdits('a\nb', [insertion(1, 'X\nY')])).toBe('aX\nY\nb')
  })

  it('is unaffected by groupId, which is metadata only', () => {
    const edits = [insertion(1, 'A', 'one'), finding(6, 9, 'B', 'two')]
    const regrouped = [insertion(1, 'A', 'x'), finding(6, 9, 'B', 'x')]
    expect(applyTextEdits(source, edits)).toBe(applyTextEdits(source, regrouped))
  })
})
