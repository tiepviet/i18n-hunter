import { basename, dirname, extname, join } from 'node:path'
import { atomicWriteFile } from './atomic-write.js'
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
    throw new Error('Sync input must be a JSON report')
  }
  const report = parseExtractionReport(readJsonBounded(jsonPath))
  const mdPath = outputPath ?? join(dirname(jsonPath), `${basename(jsonPath, '.json')}.md`)
  atomicWriteFile(mdPath, generateMarkdownReport(report), 0o600)
  return { jsonPath, mdPath, findingsRendered: report.findings.length }
}
