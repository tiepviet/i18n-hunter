import { basename, join } from 'node:path'
import { existsSync } from 'node:fs'
import { atomicWriteFile } from './atomic-write.js'
import { HunterError } from './errors.js'
import { ExtractionReportSchema } from './report-schema.js'
import {
  findingCategories,
  type CategorizedResults,
  type ExtractionReport,
  type FindingCategory,
  type ScanResult,
} from './types.js'

export interface ExportOptions {
  outputDir: string
  filename: string
  json?: boolean
  markdown?: boolean
  prettyJson?: boolean
}

export function categorizeFindings(findings: ScanResult[]): CategorizedResults {
  const categorized: CategorizedResults = {
    labels: [],
    buttons: [],
    messages: [],
    errors: [],
    notifications: [],
  }

  const categoryMap: Record<FindingCategory, keyof CategorizedResults> = {
    label: 'labels',
    button: 'buttons',
    message: 'messages',
    error: 'errors',
    notification: 'notifications',
  }

  for (const finding of findings) categorized[categoryMap[finding.category]].push(finding)
  return categorized
}

export function generateMarkdownReport(input: ExtractionReport): string {
  let report: ExtractionReport
  try {
    report = ExtractionReportSchema.parse(input)
  } catch (error) {
    throw new HunterError(
      'E_REPORT_SCHEMA',
      `Invalid report for Markdown export: ${(error instanceof Error ? error.message : String(error)).slice(0, 500)}`,
    )
  }
  const categorized = categorizeFindings(report.findings)
  const lines: string[] = [
    '# i18n-hunter Hunt Report',
    '',
    `**Generated:** ${report.generatedAt}`,
    '',
    report.complete ? '**Scan status:** Complete' : '**Scan status:** Incomplete',
    '',
    '## Summary',
    '',
    `- **Files discovered:** ${report.summary.filesDiscovered}`,
    `- **Files scanned:** ${report.summary.filesScanned}`,
    `- **Hardcoded strings found:** ${report.summary.findings}`,
    '',
    '### Breakdown by category',
    '',
    ...findingCategories.map(
      (category) =>
        `- ${category[0]!.toUpperCase()}${category.slice(1)}: ${report.summary.categories[category]}`,
    ),
    '',
  ]

  if (report.diagnostics.length > 0) {
    lines.push('## Diagnostics', '')
    for (const diagnostic of report.diagnostics) {
      const location = diagnostic.filePath ? ` ${inlineCode(diagnostic.filePath)}` : ''
      const message = escapeMarkdown(diagnostic.message).replace(/[\r\n]+/gu, ' ')
      lines.push(
        `- **${escapeMarkdown(diagnostic.severity.toUpperCase())}** ${inlineCode(diagnostic.code)}${location}: ${message}`,
      )
    }
    lines.push('')
  }

  const sections: Array<[string, ScanResult[]]> = [
    ['Labels', categorized.labels],
    ['Buttons', categorized.buttons],
    ['Messages', categorized.messages],
    ['Errors', categorized.errors],
    ['Notifications', categorized.notifications],
  ]

  for (const [heading, results] of sections) {
    if (results.length === 0) continue
    lines.push(`## ${heading}`, '')
    for (const result of results) lines.push(formatResult(result), '')
  }

  return `${lines.join('\n').trimEnd()}\n`
}

export function generateJsonReport(report: ExtractionReport, pretty = true): string {
  let validated: ExtractionReport
  try {
    validated = ExtractionReportSchema.parse(report)
  } catch (error) {
    throw new HunterError(
      'E_REPORT_SCHEMA',
      `Invalid report for JSON export: ${(error instanceof Error ? error.message : String(error)).slice(0, 500)}`,
    )
  }
  return pretty ? JSON.stringify(validated, null, 2) : JSON.stringify(validated)
}

export function exportReport(reportInput: ExtractionReport, options: ExportOptions): string[] {
  let report: ExtractionReport
  try {
    report = ExtractionReportSchema.parse(reportInput)
  } catch (error) {
    throw new HunterError(
      'E_REPORT_SCHEMA',
      `Invalid report for export: ${(error instanceof Error ? error.message : String(error)).slice(0, 500)}`,
    )
  }
  const { outputDir, filename, json = true, markdown = true, prettyJson = true } = options
  const safeFilename = validateFilename(filename)
  const created: string[] = []

  if (json) {
    const path = uniqueReportPath(outputDir, safeFilename, 'json')
    atomicWriteFile(path, generateJsonReport(report, prettyJson), 0o600)
    created.push(path)
  }

  if (markdown) {
    const path = uniqueReportPath(outputDir, safeFilename, 'md')
    atomicWriteFile(path, generateMarkdownReport(report), 0o600)
    created.push(path)
  }

  return created
}

function uniqueReportPath(outputDir: string, basename: string, extension: string): string {
  // Never overwrite an existing report: suffix -1, -2, … so a re-run with an
  // explicit --filename cannot silently destroy the previous report.
  const first = join(outputDir, `${basename}.${extension}`)
  if (!existsSync(first)) return first
  for (let index = 1; index <= 100; index += 1) {
    const candidate = join(outputDir, `${basename}-${index}.${extension}`)
    if (!existsSync(candidate)) return candidate
  }
  throw new HunterError('E_INVALID_INPUT', `Report file already exists: ${first}`, first)
}

export function generateSummary(reportInput: ExtractionReport): string {
  let report: ExtractionReport
  try {
    report = ExtractionReportSchema.parse(reportInput)
  } catch (error) {
    throw new HunterError(
      'E_REPORT_SCHEMA',
      `Invalid report for summary: ${(error instanceof Error ? error.message : String(error)).slice(0, 500)}`,
    )
  }
  return [
    '=== i18n-hunter — Extraction Summary ===',
    `Files discovered:      ${report.summary.filesDiscovered}`,
    `Files scanned:         ${report.summary.filesScanned}`,
    `Hardcoded strings:     ${report.summary.findings}`,
    `Scan status:           ${report.complete ? 'complete' : 'incomplete'}`,
    '',
    'By category:',
    ...findingCategories.map(
      (category) => `  ${category.padEnd(12)} ${report.summary.categories[category]}`,
    ),
  ].join('\n')
}

function formatResult(result: ScanResult): string {
  const value = result.hardcodedString ? inlineCode(result.hardcodedString) : '`[redacted]`'
  return [
    `- **${escapeMarkdown(`${result.filePath}:${result.lineNumber}:${result.columnNumber}`)}**`,
    `  - String: ${value}`,
    `  - Context: ${inlineCode(result.context)}`,
    `  - Transform: ${inlineCode(result.transform)}`,
    `  - Suggested key: ${inlineCode(result.suggestedKey)}`,
  ].join('\n')
}

function inlineCode(value: string): string {
  const singleLine = value.replace(/\r?\n/gu, '↵')
  const longestRun = Math.max(
    0,
    ...Array.from(singleLine.matchAll(/`+/gu), (match) => match[0].length),
  )
  const fence = '`'.repeat(longestRun + 1)
  const padding = singleLine.startsWith('`') || singleLine.endsWith('`') ? ' ' : ''
  // Untrusted values are HTML-escaped even inside code spans so `<img>` can never
  // appear literally in derived Markdown. This renders `a&b` as `a&amp;b` inside
  // code spans — a deliberate safety tradeoff verified by `markdown-safety.test.ts`.
  const safeValue = escapeHtml(singleLine).replace(/\[/gu, '&#91;').replace(/\]/gu, '&#93;')
  return `${fence}${padding}${safeValue}${padding}${fence}`
}

function escapeMarkdown(value: string): string {
  return escapeHtml(value).replace(/[\\[\]*_~|>]/gu, (character) => `\\${character}`)
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
    .replace(/"/gu, '&quot;')
    .replace(/'/gu, '&#39;')
}

function validateFilename(filename: string): string {
  const normalized = basename(filename)
  if (!filename || normalized !== filename || normalized === '.' || normalized === '..') {
    throw new HunterError('E_INVALID_INPUT', 'Report filename must be a single safe filename')
  }
  return normalized
}
