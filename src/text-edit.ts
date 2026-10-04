import { HunterError } from './errors.js'
import { hashText } from './source-range.js'
import type { ScanResult, SourceRange } from './types.js'

export interface TextEdit {
  range: SourceRange
  replacement: string
  kind: 'finding' | 'import' | 'hook'
  groupId?: string
}

export function validateTranslationKey(key: string): string {
  if (
    key.length < 3 ||
    key.length > 200 ||
    !/^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+){1,14}$/u.test(key)
  ) {
    throw new HunterError('E_INVALID_INPUT', `Invalid translation key: ${key}`)
  }
  return key
}

export function validateFindingsAgainstSource(content: string, findings: ScanResult[]): void {
  const fileHash = hashText(content)
  for (const finding of findings) {
    if (finding.fileSha256 !== fileHash) {
      throw new HunterError(
        'E_STALE_SOURCE',
        `Source file changed after scanning: ${finding.filePath}`,
        finding.filePath,
      )
    }
    validateTextRange(content, finding)
    validateTranslationKey(finding.suggestedKey)
  }
}

export function validateTextRange(content: string, finding: ScanResult): void {
  const { start, end } = finding.range
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    end <= start ||
    end > content.length
  ) {
    throw new HunterError(
      'E_REPORT_SCHEMA',
      `Invalid source range in ${finding.filePath}`,
      finding.filePath,
    )
  }
  const slice = content.slice(start, end)
  if (hashText(slice) !== finding.sliceSha256) {
    throw new HunterError(
      'E_STALE_SOURCE',
      `Source slice changed after scanning: ${finding.filePath}`,
      finding.filePath,
    )
  }
}

export function applyTextEdits(content: string, edits: TextEdit[]): string {
  for (const edit of edits) {
    if (
      !Number.isSafeInteger(edit.range.start) ||
      !Number.isSafeInteger(edit.range.end) ||
      edit.range.start < 0 ||
      edit.range.end < edit.range.start ||
      edit.range.end > content.length
    ) {
      throw new HunterError(
        'E_REPORT_SCHEMA',
        `Invalid edit range: ${edit.range.start}:${edit.range.end}`,
      )
    }
  }
  assertNonOverlapping(edits)
  const eol = content.includes('\r\n') ? '\r\n' : '\n'
  let result = content
  for (const edit of orderEditsRightToLeft(edits)) result = replaceAt(result, edit, eol)
  return result
}

/**
 * Every edit is expressed against the original source, so they must be applied
 * strictly right-to-left: each already-applied edit then sits at a strictly
 * greater offset and can never shift the ranges still to be applied.
 *
 * At an identical start offset a spanning edit is applied first, otherwise the
 * insertion would land inside the replacement and be silently destroyed.
 *
 * Array#sort is stable, so two insertions sharing an offset are *applied* in
 * planned order — which means they are *emitted* in reverse planned order.
 * Callers that depend on emission order must pre-reverse co-located insertions.
 */
function orderEditsRightToLeft(edits: TextEdit[]): TextEdit[] {
  return [...edits].sort((left, right) => {
    if (right.range.start !== left.range.start) return right.range.start - left.range.start
    const leftLength = left.range.end - left.range.start
    const rightLength = right.range.end - right.range.start
    return rightLength - leftLength
  })
}

function replaceAt(content: string, edit: TextEdit, eol: string): string {
  const replacement = eol === '\r\n' ? edit.replacement.replace(/\r?\n/gu, eol) : edit.replacement
  return content.slice(0, edit.range.start) + replacement + content.slice(edit.range.end)
}

/**
 * Rejects any two edits that would destroy each other: two spanning edits that
 * overlap, and an insertion strictly inside a spanning edit (it would be spliced
 * out by that replacement). An insertion exactly on a boundary is allowed,
 * because that is how hook and import edits attach to a component or file start.
 */
function assertNonOverlapping(edits: TextEdit[]): void {
  const ordered = [...edits].sort(
    (left, right) => left.range.start - right.range.start || left.range.end - right.range.end,
  )
  for (let index = 1; index < ordered.length; index += 1) {
    const previous = ordered[index - 1]!
    const current = ordered[index]!
    if (current.range.end === current.range.start) {
      const strictlyInside =
        previous.range.end > previous.range.start &&
        current.range.start > previous.range.start &&
        current.range.start < previous.range.end
      if (strictlyInside) throw new HunterError('E_REPORT_SCHEMA', 'Source edits overlap')
      continue
    }
    if (current.range.start < previous.range.end) {
      throw new HunterError('E_REPORT_SCHEMA', 'Source edits overlap')
    }
  }
}
