/**
 * i18n-hunter Report Sync
 *
 * Re-generates the Markdown report from an (edited) JSON report file.
 * Useful when the user has manually updated suggestedKeys in the JSON and
 * wants to sync those changes back into the human-readable .md report.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, dirname, basename } from 'node:path'
import { generateMarkdownReport } from './report-formatter.js'
import type { ExtractionReport } from './types.js'

export interface SyncResult {
  jsonPath: string
  mdPath: string
  keysUpdated: number
}

/**
 * Read a JSON report, regenerate the Markdown from it, and write it alongside.
 * Returns paths to both files.
 */
export function syncReportMd(jsonPath: string): SyncResult {
  if (!existsSync(jsonPath)) {
    throw new Error(`JSON report not found: ${jsonPath}`)
  }

  const report: ExtractionReport = JSON.parse(readFileSync(jsonPath, 'utf-8'))

  // Derive the .md path: same directory and base name as the JSON
  const dir = dirname(jsonPath)
  const base = basename(jsonPath, '.json')
  const mdPath = join(dir, `${base}.md`)

  const markdown = generateMarkdownReport(report)
  writeFileSync(mdPath, markdown, 'utf-8')

  return {
    jsonPath,
    mdPath,
    keysUpdated: report.totalStrings,
  }
}
