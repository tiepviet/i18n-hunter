/**
 * Report Formatter
 *
 * Converts an {@link ExtractionReport} to Markdown, JSON, or both,
 * and writes them to the filesystem.
 */

import type { ExtractionReport, ScanResult } from './types.js'
import { writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'

export interface ExportOptions {
  /** Output directory */
  outputDir: string
  /** Base filename without extension */
  filename: string
  /** Export as JSON (default: true) */
  json?: boolean
  /** Export as Markdown (default: true) */
  markdown?: boolean
  /** Pretty-print JSON (default: true) */
  prettyJson?: boolean
}

// ─────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────

/** Generate a Markdown-formatted extraction report. */
export function generateMarkdownReport(report: ExtractionReport): string {
  const lines: string[] = [
    '# i18n-hunter Hunt Report',
    '',
    `**Generated:** ${new Date().toISOString()}`,
    '',
    '## Summary',
    '',
    `- **Total Files Scanned:** ${report.totalFiles}`,
    `- **Total Hardcoded Strings Found:** ${report.totalStrings}`,
    '',
    '### Breakdown by Category',
    '',
    `- Labels: ${report.categorizedResults.labels.length}`,
    `- Buttons: ${report.categorizedResults.buttons.length}`,
    `- Messages: ${report.categorizedResults.messages.length}`,
    `- Errors: ${report.categorizedResults.errors.length}`,
    `- Notifications: ${report.categorizedResults.notifications.length}`,
    '',
  ]

  const sections: Array<[string, ScanResult[]]> = [
    ['Labels', report.categorizedResults.labels],
    ['Buttons', report.categorizedResults.buttons],
    ['Messages', report.categorizedResults.messages],
    ['Errors', report.categorizedResults.errors],
    ['Notifications', report.categorizedResults.notifications],
  ]

  for (const [heading, results] of sections) {
    if (results.length === 0) continue
    lines.push(`## ${heading}`, '')
    for (const r of results) {
      lines.push(formatResult(r), '')
    }
  }

  return lines.join('\n')
}

/** Generate a JSON-formatted extraction report. */
export function generateJsonReport(report: ExtractionReport, pretty = true): string {
  return pretty ? JSON.stringify(report, null, 2) : JSON.stringify(report)
}

/** Export a report to one or both file formats, returning created file paths. */
export function exportReport(report: ExtractionReport, options: ExportOptions): string[] {
  const { outputDir, filename, json = true, markdown = true, prettyJson = true } = options

  if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true })

  const created: string[] = []

  if (json) {
    const p = join(outputDir, `${filename}.json`)
    writeFileSync(p, generateJsonReport(report, prettyJson), 'utf-8')
    created.push(p)
    console.log(`[i18n-hunter] JSON report: ${p}`)
  }

  if (markdown) {
    const p = join(outputDir, `${filename}.md`)
    writeFileSync(p, generateMarkdownReport(report), 'utf-8')
    created.push(p)
    console.log(`[i18n-hunter] Markdown report: ${p}`)
  }

  return created
}

/** Generate a compact summary string for console output. */
export function generateSummary(report: ExtractionReport): string {
  return [
    '=== i18n-hunter — Extraction Summary ===',
    `Total Files Scanned:    ${report.totalFiles}`,
    `Total Hardcoded Strings: ${report.totalStrings}`,
    '',
    'By Category:',
    `  Labels:        ${report.categorizedResults.labels.length}`,
    `  Buttons:       ${report.categorizedResults.buttons.length}`,
    `  Messages:      ${report.categorizedResults.messages.length}`,
    `  Errors:        ${report.categorizedResults.errors.length}`,
    `  Notifications: ${report.categorizedResults.notifications.length}`,
  ].join('\n')
}

// ─────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────

function formatResult(result: ScanResult): string {
  return (
    `- **${result.filePath}:${result.lineNumber}:${result.columnNumber}**\n` +
    `  - String: \`${result.hardcodedString}\`\n` +
    `  - Context: ${result.context}\n` +
    `  - Suggested Key: \`${result.suggestedKey}\``
  )
}
