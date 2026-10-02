import { HunterError } from './errors.js'
import { isVueSourcePath } from './path-policy.js'
import { parseReactSource } from './react-parser.js'
import { hashText } from './source-range.js'
import type { ExtractedCandidate, ScanResult } from './types.js'
import { parseVueSource } from './vue-parser.js'

export async function verifyReportStructure(
  content: string,
  filePath: string,
  findings: ScanResult[],
): Promise<void> {
  const result = isVueSourcePath(filePath)
    ? await parseVueSource(content, filePath)
    : parseReactSource(content, filePath)
  if (result.diagnostics.some((diagnostic) => diagnostic.severity === 'error')) {
    throw new HunterError(
      'E_PARSE_FAILED',
      'Source cannot be reparsed during report verification',
      filePath,
    )
  }

  const candidates = new Map(result.candidates.map((candidate) => [rangeKey(candidate), candidate]))
  const reportedRanges = new Set<string>()
  for (const finding of findings) {
    const key = rangeKey(finding)
    const candidate = candidates.get(key)
    if (!candidate) {
      throw new HunterError(
        'E_REPORT_SCHEMA',
        'Finding range is not an AST-derived source finding',
        filePath,
      )
    }
    reportedRanges.add(key)
    verifyCandidateMetadata(finding, candidate, content)
  }
  for (const key of candidates.keys()) {
    if (!reportedRanges.has(key)) {
      throw new HunterError(
        'E_REPORT_SCHEMA',
        'Report omitted an AST-derived finding for this file',
        filePath,
      )
    }
  }
}

export function stableFindingId(
  filePath: string,
  range: { start: number; end: number },
  raw: string,
): string {
  return `finding-${hashText(`${filePath}:${range.start}:${range.end}:${raw}`)}`
}

function verifyCandidateMetadata(
  finding: ScanResult,
  candidate: ExtractedCandidate,
  content: string,
): void {
  const raw = content.slice(finding.range.start, finding.range.end)
  const expectedValueHash = hashText(candidate.value)
  const expectedId = stableFindingId(finding.filePath, finding.range, raw)
  const metadataMatches =
    finding.id === expectedId &&
    finding.lineNumber === candidate.lineNumber &&
    finding.columnNumber === candidate.columnNumber &&
    finding.endLineNumber === candidate.endLineNumber &&
    finding.endColumnNumber === candidate.endColumnNumber &&
    finding.context === candidate.context &&
    finding.category === candidate.category &&
    finding.transform === candidate.transform &&
    (finding.valueSha256 === undefined || finding.valueSha256 === expectedValueHash) &&
    finding.sliceSha256 === hashText(raw) &&
    Boolean(finding.isNotification) === Boolean(candidate.isNotification) &&
    finding.notificationType === candidate.notificationType &&
    componentsEqual(finding.component, candidate.component)
  if (!metadataMatches) {
    throw new HunterError(
      'E_REPORT_SCHEMA',
      'Report structural metadata does not match the current AST',
      finding.filePath,
    )
  }
  if (finding.hardcodedString !== undefined && finding.hardcodedString !== candidate.value) {
    throw new HunterError(
      'E_REPORT_SCHEMA',
      'Report value does not match the source AST',
      finding.filePath,
    )
  }
}

function componentsEqual(
  left: ScanResult['component'],
  right: ExtractedCandidate['component'],
): boolean {
  if (left === undefined || right === undefined) return left === right
  return (
    left.id === right.id &&
    left.name === right.name &&
    left.start === right.start &&
    left.end === right.end &&
    left.bodyStart === right.bodyStart &&
    left.expressionBody === right.expressionBody &&
    left.expressionStart === right.expressionStart &&
    left.expressionEnd === right.expressionEnd &&
    left.kind === right.kind
  )
}

function rangeKey(value: { range: { start: number; end: number } }): string {
  return `${value.range.start}:${value.range.end}`
}
