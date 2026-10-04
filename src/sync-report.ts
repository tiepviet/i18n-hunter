import { basename, dirname, extname, join } from 'node:path'
import { atomicWriteFile } from './atomic-write.js'
import { HunterError } from './errors.js'
import { generateMarkdownReport } from './report-formatter.js'
import { parseExtractionReport } from './report-schema.js'
import { readJsonBounded } from './safe-json.js'

export interface SyncResult {
  jsonPath: string
  mdPath: string
  findingsRendered: number
}

export function syncReportMd(jsonPath: string, outputPath?: string): SyncResult {
  if (extname(jsonPath).toLowerCase() !== '.json') {
    throw new HunterError('E_INVALID_INPUT', 'Sync input must be a JSON report', jsonPath)
  }
  const report = parseExtractionReport(readJsonBounded(jsonPath))
  // Sync intentionally overwrites the Markdown sidecar next to the JSON report.
  // This differs from exportReport, which never overwrites (uniqueReportPath
  // suffixes -1, -2, ...). Overwriting here is safe: the .md is a derived
  // view that can always be regenerated from the .json source of truth.
  // extname-aware strip handles case variants like `.JSON` that
  // basename(p, '.json') would miss (producing `report.JSON.md`).
  const mdPath =
    outputPath ?? join(dirname(jsonPath), `${basename(jsonPath, extname(jsonPath))}.md`)
  atomicWriteFile(mdPath, generateMarkdownReport(report), 0o600)
  return { jsonPath, mdPath, findingsRendered: report.findings.length }
}
